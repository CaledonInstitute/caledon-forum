import { env } from "cloudflare:workers";
import { symmetricDecrypt } from "better-auth/crypto";
import { createAuth } from "./auth";
import { one, run } from "./db";
class MembershipError extends Error {}
const inflight = new Map<string, Promise<boolean>>();
export async function refreshMembership(userId: string, force = false): Promise<boolean> {
  if (inflight.has(userId)) return inflight.get(userId)!;
  const task = refresh(userId, force).finally(() => inflight.delete(userId));
  inflight.set(userId, task);
  return task;
}
async function refresh(userId: string, force: boolean) {
  const account = await one<{ account_id: string; access_token: string | null }>("SELECT account_id,access_token FROM account WHERE user_id=? AND provider_id=?", userId, "github");
  if (!account) {
    await run("DELETE FROM memberships WHERE user_id=?", userId);
    return false;
  }
  const previous = await one<{ state: string; checked_at: number; retry_after: number }>("SELECT state,checked_at,retry_after FROM memberships WHERE user_id=?", userId);
  if (!force && previous && (previous.checked_at > Date.now() - 86400000 || previous.retry_after > Date.now()))
    return previous.state === "active" && previous.checked_at > Date.now() - 86400000;
  try {
    if (!env.BETTER_AUTH_SECRET) throw new MembershipError("Membership verification is not configured. Contact the forum administrator.");
    if (!account.access_token) throw new MembershipError("Reconnect GitHub to verify membership.");
    let token: string;
    try {
      // Use the same token format and secret configuration as the OAuth writer.
      // This also supports accounts linked before token encryption was enabled.
      const encrypted = account.access_token.startsWith("$ba$") || (account.access_token.length % 2 === 0 && /^[0-9a-f]+$/i.test(account.access_token));
      token = encrypted ? await symmetricDecrypt({ key: (await createAuth().$context).secretConfig, data: account.access_token }) : account.access_token;
    } catch {
      throw new MembershipError("Your saved GitHub access could not be read. Reconnect GitHub to verify membership.");
    }
    const response = await fetch("https://api.github.com/user/memberships/orgs/CaledonInstitute", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "CaledonForum" },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401) throw new MembershipError("GitHub access has expired or been revoked. Reconnect GitHub to verify membership.");
    if (response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after"))))
      throw new MembershipError("GitHub API rate limit reached. Please try again later.");
    if (response.status === 403)
      throw new MembershipError(
        response.headers.get("x-github-sso")?.includes("required")
          ? "Authorize the GitHub OAuth app for CaledonInstitute SSO, then try again."
          : "GitHub denied organization access. Reconnect GitHub to grant read:org access and check that CaledonInstitute allows this OAuth app."
      );
    if (!response.ok && response.status !== 404) throw new MembershipError(`GitHub membership verification failed (HTTP ${response.status}). Please try again later.`);
    const info = response.ok ? ((await response.json()) as { state: string }) : { state: "none" };
    const state = info.state === "active" ? "active" : "none";
    await run(
      "INSERT INTO memberships(user_id,github_id,state,checked_at,retry_after) VALUES(?,?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET github_id=excluded.github_id,state=excluded.state,checked_at=excluded.checked_at,retry_after=0",
      userId,
      account.account_id,
      state,
      Date.now()
    );
    return state === "active";
  } catch (error) {
    await run(
      "INSERT INTO memberships(user_id,github_id,state,checked_at,retry_after) VALUES(?,?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET retry_after=excluded.retry_after",
      userId,
      account.account_id,
      "unknown",
      Date.now() + 300000
    );
    if (force) {
      if (error instanceof MembershipError) throw error;
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
        throw new MembershipError("GitHub membership verification timed out. Please try again.");
      throw new MembershipError("Unable to reach GitHub or read its membership response. Please try again.");
    }
    return false;
  }
}
