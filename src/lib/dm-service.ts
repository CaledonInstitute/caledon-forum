import { z } from "zod";
import { all, one, run, db } from "./db";
import { verifyPassword } from "better-auth/crypto";
import { vaultSchema, reconcileVault } from "./dm-vault";
import type { Viewer } from "./types";
import { signalDirectMessages as notify } from "./control";
const keySchema = z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string().regex(/^[A-Za-z0-9_-]{43}$/), y: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
const id = z.string().min(1).max(100);
const envelope = z
  .object({
    enc: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(200),
    ct: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .min(20)
      .max(40000),
  })
  .strict();
export async function dmUnread(userId: string) {
  return (
    (
      await one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM dm_messages m JOIN dm_conversations c ON c.id=m.conversation_id LEFT JOIN dm_reads r ON r.conversation_id=c.id AND r.user_id=? WHERE (c.user_a=? OR c.user_b=?) AND m.sender_id<>? AND m.seq>COALESCE(r.seq,0)`,
        userId,
        userId,
        userId,
        userId
      )
    )?.n || 0
  );
}

export async function dmAction(user: Viewer, action: string, data: any, write: boolean) {
  if (user.suspended || !user.emailVerified || !user.username) throw new Error("DM requires an active account with a verified email and username.");
  await reconcileVault(user.id);
  const vault = await one<any>("SELECT * FROM dm_vaults WHERE user_id=?", user.id);
  if (action === "vault") {
    const credential = await one<{ password: string }>("SELECT password FROM account WHERE user_id=? AND provider_id='credential'", user.id);
    if (!write)
      return {
        userId: user.id,
        hasPassword: !!credential?.password,
        version: vault?.version || 1,
        publicKey: vault?.public_key ? JSON.parse(vault.public_key) : null,
        vault: vault?.vault ? JSON.parse(vault.vault) : null,
      };
    const input = z.object({ password: z.string().min(12).max(128), version: z.number().int().positive(), publicKey: keySchema, vault: vaultSchema }).parse(data);
    if (!credential?.password || !(await verifyPassword({ password: input.password, hash: credential.password }))) throw new Error("Check your account password.");
    await crypto.subtle.importKey("jwk", input.publicKey, { name: "ECDH", namedCurve: "P-256" }, true, []);
    const result = await run(
      `INSERT INTO dm_vaults(user_id,version,public_key,vault) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET public_key=excluded.public_key,vault=excluded.vault,invalidated=0 WHERE dm_vaults.invalidated=1 AND dm_vaults.version=excluded.version`,
      user.id,
      input.version,
      JSON.stringify(input.publicKey),
      JSON.stringify(input.vault)
    );
    if (!result.meta.changes) throw new Error("DM is already activated. Reload to unlock it.");
    const peers = await all<{ id: string }>(
      "SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END AS id FROM dm_conversations WHERE user_a=? OR user_b=?",
      user.id,
      user.id,
      user.id
    );
    await notify([user.id, ...peers.map((p) => p.id)]);
    return { ok: true };
  }
  if (action === "users") {
    const query = z
      .string()
      .max(30)
      .regex(/^[a-zA-Z0-9_]*$/)
      .parse(data.query || "");
    return {
      items: await all(
        `SELECT u.id,u.name,u.username,u.image,v.version,v.public_key AS publicKey FROM user u JOIN dm_vaults v ON v.user_id=u.id AND v.invalidated=0 WHERE u.suspended=0 AND u.email_verified=1 AND u.id<>? AND u.username IS NOT NULL AND substr(u.username,1,length(?))=? COLLATE NOCASE AND NOT EXISTS(SELECT 1 FROM dm_blocks b WHERE (b.user_id=? AND b.blocked_id=u.id) OR (b.blocked_id=? AND b.user_id=u.id)) ORDER BY u.username LIMIT 12`,
        user.id,
        query,
        query,
        user.id,
        user.id
      ),
    };
  }
  if (action === "inbox")
    return {
      unread: await dmUnread(user.id),
      items: await all(
        `SELECT c.*,u.id AS peerId,u.username,u.name,u.image,(SELECT COUNT(*) FROM dm_messages m WHERE m.conversation_id=c.id AND m.sender_id<>? AND m.seq>COALESCE(r.seq,0)) AS unread FROM dm_conversations c JOIN user u ON u.id=CASE WHEN c.user_a=? THEN c.user_b ELSE c.user_a END LEFT JOIN dm_reads r ON r.conversation_id=c.id AND r.user_id=? WHERE c.user_a=? OR c.user_b=? ORDER BY c.updated_at DESC LIMIT 100`,
        user.id,
        user.id,
        user.id,
        user.id,
        user.id
      ),
    };
  if (action === "blocks") return { items: await all("SELECT u.id,u.name,u.username FROM dm_blocks b JOIN user u ON u.id=b.blocked_id WHERE b.user_id=?", user.id) };
  if (action === "block" && write) {
    const input = z.object({ userId: id, blocked: z.boolean() }).parse(data);
    if (input.userId === user.id) throw new Error("Select another user.");
    if (input.blocked) await run("INSERT OR IGNORE INTO dm_blocks(user_id,blocked_id) SELECT ?,id FROM user WHERE id=?", user.id, input.userId);
    else await run("DELETE FROM dm_blocks WHERE user_id=? AND blocked_id=?", user.id, input.userId);
    await notify([user.id, input.userId]);
    return { ok: true };
  }
  if (action === "conversation" && write) {
    if (!vault || vault.invalidated) throw new Error("Activate DM first.");
    const peer = await one<any>(
      "SELECT u.id FROM user u JOIN dm_vaults v ON v.user_id=u.id WHERE u.username=? COLLATE NOCASE AND u.suspended=0 AND u.email_verified=1 AND v.invalidated=0",
      z.string().min(1).max(30).parse(data.username)
    );
    if (!peer || peer.id === user.id) throw new Error("This user is not available for DM.");
    if (await blocked(user.id, peer.id)) throw new Error("Messaging is blocked.");
    const [a, b] = [user.id, peer.id].sort();
    const now = Date.now();
    await run("INSERT OR IGNORE INTO dm_conversations(id,user_a,user_b,created_at,updated_at) VALUES(?,?,?,?,?)", crypto.randomUUID(), a, b, now, now);
    return await one("SELECT id FROM dm_conversations WHERE user_a=? AND user_b=?", a, b);
  }
  const conversation = await one<any>("SELECT * FROM dm_conversations WHERE id=? AND (user_a=? OR user_b=?)", id.parse(data.conversationId), user.id, user.id);
  if (!conversation) throw new Response(JSON.stringify({ error: "Conversation not found." }), { status: 404, headers: { "Content-Type": "application/json" } });
  const peerId = conversation.user_a === user.id ? conversation.user_b : conversation.user_a;
  await reconcileVault(peerId);
  const peer = await one<any>(
    "SELECT u.id,u.username,u.name,u.image,u.suspended,u.email_verified AS emailVerified,v.version,v.public_key AS publicKey,v.invalidated FROM user u LEFT JOIN dm_vaults v ON v.user_id=u.id WHERE u.id=?",
    peerId
  );
  if (action === "messages" && !write) {
    const before = z.coerce.number().int().positive().optional().parse(data.before);
    return {
      peer,
      blocked: !!(await blocked(user.id, peerId)),
      ownBlocked: !!(await one("SELECT 1 FROM dm_blocks WHERE user_id=? AND blocked_id=?", user.id, peerId)),
      items: await all("SELECT * FROM dm_messages WHERE conversation_id=? AND seq<? ORDER BY seq DESC LIMIT 51", conversation.id, before || Number.MAX_SAFE_INTEGER),
    };
  }
  if (action === "read" && write) {
    const seq = z.number().int().nonnegative().parse(data.seq);
    const result = await run(
      "INSERT INTO dm_reads(conversation_id,user_id,seq) SELECT ?,?,MAX(seq) FROM dm_messages WHERE conversation_id=? AND seq<=? HAVING MAX(seq) IS NOT NULL ON CONFLICT(conversation_id,user_id) DO UPDATE SET seq=excluded.seq WHERE excluded.seq>dm_reads.seq",
      conversation.id,
      user.id,
      conversation.id,
      seq
    );
    if (result.meta.changes) await notify([user.id]);
    return { ok: true };
  }
  if (action === "send" && write) {
    const input = z
      .object({
        id: z.uuid(),
        senderVersion: z.number().int().positive(),
        recipientVersion: z.number().int().positive(),
        envelopes: z.object({ sender: envelope, recipient: envelope }).strict(),
      })
      .parse(data);
    const previous = await one<any>("SELECT * FROM dm_messages WHERE id=?", input.id);
    if (previous) {
      if (
        previous.sender_id !== user.id ||
        previous.conversation_id !== conversation.id ||
        previous.envelopes !== JSON.stringify(input.envelopes) ||
        previous.sender_version !== input.senderVersion ||
        previous.recipient_version !== input.recipientVersion
      )
        throw new Error("Message ID already used.");
      return { ok: true, id: input.id };
    }
    if (
      !vault ||
      vault.invalidated ||
      vault.pending_vault ||
      !peer?.publicKey ||
      peer.invalidated ||
      peer.suspended ||
      !peer.emailVerified ||
      vault.version !== input.senderVersion ||
      peer.version !== input.recipientVersion
    )
      throw new Error("Encryption keys changed. Reload and unlock DM before sending.");
    if (await blocked(user.id, peerId)) throw new Error("Messaging is blocked.");
    const now = Date.now();
    const result = await db().batch([
      db()
        .prepare(
          `INSERT INTO dm_messages(id,conversation_id,sender_id,sender_version,recipient_version,sender_public_key,envelopes,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM dm_vaults v JOIN user u ON u.id=v.user_id WHERE v.user_id=? AND v.version=? AND v.invalidated=0 AND v.pending_vault IS NULL AND u.suspended=0 AND u.email_verified=1 AND u.username IS NOT NULL) AND EXISTS(SELECT 1 FROM dm_vaults v JOIN user u ON u.id=v.user_id WHERE v.user_id=? AND v.version=? AND v.invalidated=0 AND v.pending_vault IS NULL AND u.suspended=0 AND u.email_verified=1 AND u.username IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM dm_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?))`
        )
        .bind(
          input.id,
          conversation.id,
          user.id,
          input.senderVersion,
          input.recipientVersion,
          vault.public_key,
          JSON.stringify(input.envelopes),
          now,
          user.id,
          input.senderVersion,
          peerId,
          input.recipientVersion,
          user.id,
          peerId,
          peerId,
          user.id
        ),
      db().prepare("UPDATE dm_conversations SET updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM dm_messages WHERE id=?)").bind(now, conversation.id, input.id),
    ]);
    if (!result[0].meta.changes) throw new Error("Keys or messaging permissions changed. Try again.");
    await notify([user.id, peerId]);
    return { ok: true, id: input.id };
  }
  throw new Error("Unknown DM action.");
}
async function blocked(a: string, b: string) {
  return one("SELECT 1 FROM dm_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)", a, b, b, a);
}
