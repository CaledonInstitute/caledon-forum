import { beforeEach, it, expect, vi } from "vitest";
import { resetDatabase, seedUser, row, execute, env } from "./runtime";
import { POST } from "../src/pages/api/account/delete";
const state = vi.hoisted(() => ({ session: null as any }));
vi.mock("../src/lib/auth", () => ({
  createAuth: () => ({ api: { getSession: async () => state.session }, handler: async () => new Response("{}", { headers: { "Set-Cookie": "session=; Max-Age=0; Path=/" } }) }),
}));
function request(data: unknown, origin = env.SITE_URL) {
  return POST({
    request: new Request(`${env.SITE_URL}/api/account/delete`, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    cookies: { delete: vi.fn() },
  } as any);
}
beforeEach(() => {
  resetDatabase();
  seedUser();
  seedUser("bob");
  state.session = { user: { id: "alice" }, session: { id: "initial-session", createdAt: new Date() } };
});
it("requires a new same-account session, correct confirmation and an unexpired intent", async () => {
  const prepared = await request({ action: "prepare" });
  const { token } = (await prepared.json()) as any;
  expect((await request({ token, confirmation: "alice" })).status).toBe(400);
  state.session = { user: { id: "bob" }, session: { id: "new-session", createdAt: new Date() } };
  expect((await request({ token, confirmation: "alice" })).status).toBe(400);
  state.session = { user: { id: "alice" }, session: { id: "new-session", createdAt: new Date(Date.now() + 1) } };
  expect((await request({ token, confirmation: "wrong" })).status).toBe(400);
  execute("UPDATE deletion_intents SET expires_at=0 WHERE token=?", token);
  expect((await request({ token, confirmation: "alice" })).status).toBe(400);
  expect(row("SELECT deleting_at FROM user WHERE id='alice'").deleting_at).toBeNull();
});
it("closes an account only after explicit post-login confirmation and clears its session cookie", async () => {
  const { token } = (await (await request({ action: "prepare" })).json()) as any;
  state.session.session = { id: "fresh-session", createdAt: new Date(Date.now() + 1) };
  const result = await request({ token, confirmation: "alice" });
  expect(result.status).toBe(202);
  expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(row("SELECT deleting_at FROM user WHERE id='alice'").deleting_at).toBeTruthy();
});
it("rejects cross-origin and unauthenticated requests", async () => {
  expect((await request({ action: "prepare" }, "https://evil.com")).status).toBe(403);
  state.session = null;
  expect((await request({ action: "prepare" })).status).toBe(401);
});
