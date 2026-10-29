import { beforeEach, afterEach, it, expect } from "vitest";
import { env, resetDatabase, seedUser, execute, row } from "./runtime";
import { authReady, createAuth, googleReady } from "../src/lib/auth";
import { ALL } from "../src/pages/api/auth/[...all]";
beforeEach(() => {
  resetDatabase();
  env.AUTH_ENABLED = "true";
  env.TURNSTILE_SECRET_KEY = "test-only";
});
afterEach(() => {
  env.AUTH_ENABLED = "false";
  delete env.TURNSTILE_SECRET_KEY;
  delete env.GOOGLE_CLIENT_ID;
  delete env.GOOGLE_CLIENT_SECRET;
});
async function request(path: string) {
  return ALL({
    params: { all: path },
    locals: { user: null },
    request: new Request(`http://localhost:4321/api/auth/${path}`, {
      method: "POST",
      headers: { origin: "http://localhost:4321", "Content-Type": "application/json" },
      body: "{}",
    }),
  } as any);
}
for (const path of ["get-access-token", "get-access-token/", "refresh-token", "sign-in/email", "update-user", "change-email"])
  it(`blocks browser capability ${path}`, async () => expect((await request(path)).status).toBe(404));
it("fails closed when authentication is disabled", async () => {
  env.AUTH_ENABLED = "false";
  expect((await request("sign-in/username")).status).toBe(503);
});
it("enables Google only when both optional credentials are configured", () => {
  expect(authReady()).toBe(true);
  expect(googleReady()).toBe(false);
  expect(createAuth().options.socialProviders).not.toHaveProperty("google");
  env.GOOGLE_CLIENT_ID = "google-test";
  expect(googleReady()).toBe(false);
  expect(authReady()).toBe(true);
  env.GOOGLE_CLIENT_SECRET = "google-secret";
  expect(googleReady()).toBe(true);
  expect(createAuth().options.socialProviders).toHaveProperty("google.clientId", "google-test");
  expect(createAuth().options.account?.accountLinking?.disableImplicitLinking).toBe(true);
});
it("routes the Google callback to Better Auth, which rejects a missing state", async () => {
  const response = await ALL({ params: { all: "callback/google" }, locals: { user: null }, request: new Request("http://localhost:4321/api/auth/callback/google") } as any);
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toContain("state_not_found");
});
async function unlink(user: any, providerId: string, origin = "http://localhost:4321") {
  return ALL({
    params: { all: "unlink-account" },
    locals: { user },
    request: new Request("http://localhost:4321/api/auth/unlink-account", {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({ providerId }),
    }),
  } as any);
}
it("protects the last login method atomically and clears only GitHub membership", async () => {
  const user = seedUser();
  for (const provider of ["google", "github"])
    execute("INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES(?,?,?,?,?,?)", provider, provider, provider, user.id, 1, 1);
  execute("INSERT INTO memberships(user_id,github_id,state,checked_at) VALUES(?,'github','active',?)", user.id, Date.now());
  expect((await unlink(user, "google", "https://evil.test")).status).toBe(403);
  expect((await unlink(null, "google")).status).toBe(401);
  expect((await unlink(user, "google")).status).toBe(200);
  expect(row("SELECT COUNT(*) n FROM memberships").n).toBe(1);
  expect((await unlink(user, "github")).status).toBe(400);
  execute("INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES('password','password','credential',?,1,1)", user.id);
  expect((await unlink(user, "github")).status).toBe(200);
  expect(row("SELECT COUNT(*) n FROM memberships").n).toBe(0);
});
it("cannot unlink all login methods with concurrent requests", async () => {
  const user = seedUser();
  for (const provider of ["google", "github"])
    execute("INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES(?,?,?,?,?,?)", provider, provider, provider, user.id, 1, 1);
  const result = await Promise.all([unlink(user, "google"), unlink(user, "github")]);
  expect(result.map((r) => r.status).sort()).toEqual([200, 400]);
  expect(row("SELECT COUNT(*) n FROM account").n).toBe(1);
});
