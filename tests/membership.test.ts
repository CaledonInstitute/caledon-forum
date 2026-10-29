import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { symmetricEncrypt } from "better-auth/crypto";
import { createAuth } from "../src/lib/auth";
import { refreshMembership } from "../src/lib/membership";
import { env, execute, resetDatabase, row, seedUser } from "./runtime";

beforeEach(() => {
  resetDatabase();
  seedUser();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ state: "active" }))
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function link(token: string | null) {
  execute(
    "INSERT INTO account(id,account_id,provider_id,user_id,access_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    "github-account",
    "1234",
    "github",
    "alice",
    token,
    Date.now(),
    Date.now()
  );
}

it("verifies older plaintext OAuth tokens without trying to decrypt them", async () => {
  link("gho_legacy_test_token");
  expect(await refreshMembership("alice", true)).toBe(true);
  expect(fetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer gho_legacy_test_token" }),
    })
  );
});

it("uses the auth secret configuration for versioned encrypted tokens", async () => {
  vi.stubEnv("BETTER_AUTH_SECRETS", "1:rotation-test-secret-012345678901234567890123456789");
  const context = await createAuth().$context;
  link(await symmetricEncrypt({ key: context.secretConfig, data: "gho_envelope_test_token" }));
  expect(await refreshMembership("alice", true)).toBe(true);
  expect(fetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer gho_envelope_test_token" }),
    })
  );
});

it.each([
  [401, {}, /expired or been revoked/],
  [403, {}, /read:org/],
  [403, { "x-github-sso": "required; url=https://github.com/sso" }, /SSO/],
  [403, { "x-ratelimit-remaining": "0" }, /rate limit/],
  [429, {}, /rate limit/],
  [503, {}, /HTTP 503/],
] as const)("reports actionable GitHub errors for HTTP %s (%j)", async (status, headers, message) => {
  link(await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: "oauth-test" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status, headers }))
  );
  await expect(refreshMembership("alice", true)).rejects.toThrow(message);
  expect(row("SELECT state,retry_after FROM memberships")).toMatchObject({ state: "unknown", retry_after: expect.any(Number) });
  expect(row("SELECT retry_after FROM memberships").retry_after).toBeGreaterThan(Date.now());
  expect(await refreshMembership("alice")).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([null, "00".repeat(64)])("asks to reconnect for missing or unreadable tokens", async (token) => {
  link(token);
  await expect(refreshMembership("alice", true)).rejects.toThrow(/Reconnect GitHub/);
  expect(fetch).not.toHaveBeenCalled();
});

it("reports timeouts and allows a forced retry during backoff", async () => {
  link("gho_test_token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new DOMException("Timed out", "TimeoutError");
    })
  );
  await expect(refreshMembership("alice", true)).rejects.toThrow(/timed out/);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ state: "active" }))
  );
  expect(await refreshMembership("alice", true)).toBe(true);
});
