import { it, expect } from "vitest";
import { createIdentity, encryptMessage, decryptMessage } from "../src/lib/dm-crypto";
import { decryptAttachment } from "../src/lib/client-uploads";
import type { PrivateAttachment } from "../src/lib/upload-policy";
it("keeps the file key and name inside authenticated DM envelopes and detects tampering", async () => {
  const sender = await createIdentity("sender", 1, "Test-password-123456"),
    recipient = await createIdentity("recipient", 1, "Test-password-123456");
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode("Confidential notes");
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  const file: PrivateAttachment = {
    id: crypto.randomUUID(),
    name: "private-notes.txt",
    mime: "text/plain",
    size: bytes.length,
    key: Buffer.from(await crypto.subtle.exportKey("raw", key)).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
  };
  const context = { id: crypto.randomUUID(), conversationId: crypto.randomUUID(), senderId: "sender", recipientId: "recipient", senderVersion: 1, recipientVersion: 1 };
  const envelopes = await encryptMessage(sender.identity, recipient.identity.publicKey, context, { text: "", attachments: [file] });
  expect(JSON.stringify(envelopes)).not.toContain(file.name);
  expect(JSON.stringify(envelopes)).not.toContain(file.key);
  const message = {
    id: context.id,
    conversation_id: context.conversationId,
    sender_id: "sender",
    sender_version: 1,
    recipient_version: 1,
    sender_public_key: JSON.stringify(sender.identity.publicKey),
    envelopes: JSON.stringify(envelopes),
  };
  const payload = await decryptMessage(recipient.identity, message, "sender");
  expect(payload.attachments?.[0]).toEqual(file);
  expect(new TextDecoder().decode(await decryptAttachment(payload.attachments![0], ciphertext))).toBe("Confidential notes");
  const corrupted = new Uint8Array(ciphertext);
  corrupted[0] ^= 1;
  await expect(decryptAttachment(file, corrupted.buffer)).rejects.toThrow();
  const invalid = await encryptMessage(sender.identity, recipient.identity.publicKey, context, { text: "", attachments: [{ ...file, mime: "text/html" }] });
  await expect(decryptMessage(recipient.identity, { ...message, envelopes: JSON.stringify(invalid) }, "sender")).rejects.toThrow("Invalid attachment");
});
