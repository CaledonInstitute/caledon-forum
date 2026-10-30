import { beforeEach, expect, it } from "vitest";
import { resetDatabase, seedUser, execute, row } from "./runtime";
import { dmAction, dmUnread } from "../src/lib/dm-service";
import { reconcileVault, stagePasswordVault } from "../src/lib/dm-vault";
import { createIdentity, encryptMessage, decryptMessage, unlockPrivate, wrapPrivate } from "../src/lib/dm-crypto";
import { hashPassword } from "better-auth/crypto";
import { ALL as endpoint } from "../src/pages/api/dm/[action]";
let alice: any, bob: any, charlie: any;
const password = "a secure local test password";
beforeEach(() => {
  resetDatabase();
  alice = seedUser();
  bob = seedUser("bob");
  charlie = seedUser("charlie");
});
async function activate(user: any) {
  const key = await createIdentity(user.id, 1, password);
  execute("INSERT INTO dm_vaults(user_id,version,public_key,vault) VALUES(?,?,?,?)", user.id, 1, JSON.stringify(key.identity.publicKey), JSON.stringify(key.vault));
  return key;
}
async function conversation() {
  return (await dmAction(alice, "conversation", { username: "bob" }, true)) as any;
}
async function fixture() {
  const a = await activate(alice),
    b = await activate(bob),
    c = await conversation();
  const context = { id: crypto.randomUUID(), conversationId: c.id, senderId: alice.id, recipientId: bob.id, senderVersion: 1, recipientVersion: 1 };
  const envelopes = await encryptMessage(a.identity, b.identity.publicKey, context, { text: "Private hello", post: "/p/123" });
  return { a, b, c, input: { ...context, envelopes } };
}
it("encrypts authenticated envelopes for both participants, binds context and rejects tampering", async () => {
  const { a, b, c, input } = await fixture();
  await dmAction(alice, "send", input, true);
  const stored = row("SELECT * FROM dm_messages WHERE id=?", input.id);
  expect(stored.envelopes).not.toContain("Private hello");
  expect(await decryptMessage(a.identity, stored, bob.id)).toEqual({ text: "Private hello", post: "/p/123" });
  expect(await decryptMessage(b.identity, stored, alice.id)).toEqual({ text: "Private hello", post: "/p/123" });
  await expect(decryptMessage(b.identity, { ...stored, conversation_id: "other" }, alice.id)).rejects.toThrow();
  const altered = JSON.parse(stored.envelopes);
  altered.recipient.ct = altered.recipient.ct.slice(0, -4) + "AAAA";
  await expect(decryptMessage(b.identity, { ...stored, envelopes: JSON.stringify(altered) }, alice.id)).rejects.toThrow();
  expect(await dmUnread(bob.id)).toBe(1);
  await dmAction(bob, "read", { conversationId: c.id, seq: stored.seq }, true);
  expect(await dmUnread(bob.id)).toBe(0);
});
it("prevents outsiders reading messages and keeps retries idempotent", async () => {
  const { c, input } = await fixture();
  await dmAction(alice, "send", input, true);
  await dmAction(alice, "send", input, true);
  expect(row("SELECT COUNT(*) AS n FROM dm_messages").n).toBe(1);
  await expect(dmAction(charlie, "messages", { conversationId: c.id }, false)).rejects.toMatchObject({ status: 404 });
  await expect(
    dmAction(alice, "send", { ...input, envelopes: { ...input.envelopes, sender: { ...input.envelopes.sender, ct: input.envelopes.sender.ct + "A" } } }, true)
  ).rejects.toThrow("already used");
});
it("enforces blocks in both directions and rejects stale versions", async () => {
  const { input } = await fixture();
  await dmAction(bob, "block", { userId: alice.id, blocked: true }, true);
  await expect(dmAction(alice, "send", input, true)).rejects.toThrow("blocked");
  await dmAction(bob, "block", { userId: alice.id, blocked: false }, true);
  execute("UPDATE dm_vaults SET version=2 WHERE user_id='bob'");
  await expect(dmAction(alice, "send", input, true)).rejects.toThrow("keys changed");
});
it("rewraps a private key and recovers a password update after credential commit", async () => {
  const { identity, vault } = await activate(alice);
  await expect(unlockPrivate(vault, "wrong password")).rejects.toThrow();
  const next = "a completely different password";
  const wrapped = await wrapPrivate(identity.privateKey, next);
  await stagePasswordVault(alice.id, "new-hash", wrapped, false);
  await reconcileVault(alice.id);
  expect(JSON.parse(row("SELECT vault FROM dm_vaults WHERE user_id='alice'").vault)).toEqual(vault);
  execute("INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES('credential','alice','credential','alice','new-hash',1,1)");
  await reconcileVault(alice.id);
  expect(JSON.parse(row("SELECT vault FROM dm_vaults WHERE user_id='alice'").vault)).toEqual(wrapped);
  expect(await crypto.subtle.exportKey("jwk", await unlockPrivate(wrapped, next))).toEqual(await crypto.subtle.exportKey("jwk", identity.privateKey));
  await expect(unlockPrivate(wrapped, password)).rejects.toThrow();
});
it("invalidates reset keys, rejects old envelopes, preserves the other participant's copy", async () => {
  const { b, input } = await fixture();
  await dmAction(alice, "send", input, true);
  execute("INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES('credential','alice','credential','alice','old-hash',1,1)");
  await stagePasswordVault(alice.id, "reset-hash", undefined, true);
  execute("UPDATE account SET password='reset-hash' WHERE user_id='alice'");
  await reconcileVault(alice.id);
  const state = (await dmAction(alice, "vault", {}, false)) as any;
  expect(state).toMatchObject({ version: 2, vault: null, publicKey: null });
  const replacement = await createIdentity(alice.id, 2, password);
  await expect(decryptMessage(replacement.identity, row("SELECT * FROM dm_messages"), bob.id)).rejects.toThrow("previous encryption key");
  expect((await decryptMessage(b.identity, row("SELECT * FROM dm_messages"), alice.id)).text).toBe("Private hello");
});
it("requires password verification on activation and prevents replacing a live vault", async () => {
  const key = await createIdentity(alice.id, 1, password);
  execute(
    "INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES('credential','alice','credential','alice',?,1,1)",
    await hashPassword(password)
  );
  const data = { password, version: 1, publicKey: key.identity.publicKey, vault: key.vault };
  await expect(dmAction(alice, "vault", { ...data, password: "wrong password" }, true)).rejects.toThrow("password");
  await dmAction(alice, "vault", data, true);
  await expect(dmAction(alice, "vault", data, true)).rejects.toThrow("already activated");
});
it("requires session, same-origin writes and verified accounts", async () => {
  const context = (user: any, origin = "http://localhost:4321") =>
    ({
      params: { action: "send" },
      locals: { user },
      url: new URL("http://localhost/api/dm/send"),
      request: new Request("http://localhost/api/dm/send", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: "{}" }),
    }) as any;
  expect((await endpoint(context(null))).status).toBe(401);
  expect((await endpoint(context(alice, "https://attacker.invalid"))).status).toBe(403);
  await expect(dmAction({ ...alice, emailVerified: false }, "inbox", {}, false)).rejects.toThrow("verified email");
});

it("rejects sending to a recipient whose email is no longer verified", async () => {
  const { input } = await fixture();
  execute("UPDATE user SET email_verified=0 WHERE id='bob'");
  await expect(dmAction(alice, "send", input, true)).rejects.toThrow();
});
