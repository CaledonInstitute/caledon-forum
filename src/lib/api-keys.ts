import { env } from "cloudflare:workers";
import { one, run } from "./db";
import type { Viewer } from "./types";

export interface KeyMetadata {
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}
export const keyMetadata = (userId: string) => one<KeyMetadata>("SELECT prefix,created_at AS createdAt,last_used_at AS lastUsedAt FROM api_keys WHERE user_id=?", userId);
export async function hashKey(key: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function requireApiAccount(user: Viewer | null): asserts user is Viewer {
  if (!user) throw Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (user.suspended || !user.emailVerified || !user.username)
    throw Response.json({ error: "API access requires an active account with a username and verified email." }, { status: 403 });
}
export async function issueKey(userId: string, regenerate = false) {
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  const key = `cfk_${secret}`,
    hash = await hashKey(key),
    prefix = key.slice(0, 12),
    now = Date.now();
  const result = regenerate
    ? await run("UPDATE api_keys SET key_hash=?,prefix=?,created_at=?,last_used_at=NULL WHERE user_id=?", hash, prefix, now, userId)
    : await run("INSERT OR IGNORE INTO api_keys(user_id,key_hash,prefix,created_at) VALUES(?,?,?,?)", userId, hash, prefix, now);
  if (!result.meta.changes) throw Response.json({ error: regenerate ? "Generate a key first." : "A key already exists. Use regenerate to replace it." }, { status: 409 });
  return { key, prefix, createdAt: now, lastUsedAt: null };
}
export async function authenticateKey(request: Request): Promise<Viewer> {
  if (env.AUTH_ENABLED !== "true") throw Response.json({ error: "API access is unavailable." }, { status: 503 });
  const token = request.headers.get("authorization")?.match(/^Bearer (cfk_[a-f0-9]{64})$/i)?.[1];
  if (!token) throw Response.json({ error: "A valid Bearer API key is required." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  const hash = await hashKey(token);
  const user = await one<Viewer>(
    `SELECT u.id,u.username,u.name,u.email_verified AS emailVerified,u.image,u.cover_image AS coverImage,u.bio,u.location,u.role,u.suspended FROM api_keys k JOIN user u ON u.id=k.user_id WHERE k.key_hash=?`,
    hash
  );
  if (!user) throw Response.json({ error: "Invalid or revoked API key." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  requireApiAccount(user);
  await run("UPDATE api_keys SET last_used_at=? WHERE key_hash=?", Date.now(), hash);
  return { ...user, emailVerified: !!user.emailVerified, suspended: !!user.suspended };
}
