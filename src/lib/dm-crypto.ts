import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256, Aes256Gcm } from "@hpke/core";
const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const encode = (value: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
export const decode = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
export type WrappedKey = { salt: string; iv: string; ciphertext: string };
export type Identity = { privateKey: CryptoKey; publicKey: JsonWebKey; version: number; userId: string };
export type Payload = { text: string; post?: string };
export type MessageContext = { id: string; conversationId: string; senderId: string; recipientId: string; senderVersion: number; recipientVersion: number };
const aad = (ctx: MessageContext) =>
  encoder.encode(JSON.stringify(["caledon-dm-v1", ctx.id, ctx.conversationId, ctx.senderId, ctx.recipientId, ctx.senderVersion, ctx.recipientVersion]));
async function passwordKey(password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as BufferSource, iterations: 600000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}
async function encryptPrivate(privateKey: CryptoKey, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return {
    iv: encode(iv),
    ciphertext: encode(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(await crypto.subtle.exportKey("jwk", privateKey))))),
  };
}
async function decryptPrivate(wrapped: { iv: string; ciphertext: string }, key: CryptoKey) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(wrapped.iv) as BufferSource }, key, decode(wrapped.ciphertext) as BufferSource);
  return crypto.subtle.importKey("jwk", JSON.parse(decoder.decode(plain)), { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
}
export async function wrapPrivate(privateKey: CryptoKey, password: string): Promise<WrappedKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: encode(salt), ...(await encryptPrivate(privateKey, await passwordKey(password, salt))) };
}
export async function unlockPrivate(vault: WrappedKey, password: string) {
  return decryptPrivate(vault, await passwordKey(password, decode(vault.salt)));
}
export async function createIdentity(userId: string, version: number, password: string) {
  const pair = await suite.kem.generateKeyPair();
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicKey = { kty: exported.kty!, crv: exported.crv!, x: exported.x!, y: exported.y! };
  return { identity: { userId, version, privateKey: pair.privateKey, publicKey }, vault: await wrapPrivate(pair.privateKey, password) };
}
export async function encryptMessage(identity: Identity, peerKey: JsonWebKey, context: MessageContext, payload: Payload) {
  const bytes = encoder.encode(JSON.stringify(payload));
  const info = encoder.encode("Caledon direct message v1");
  const seal = async (jwk: JsonWebKey) => {
    const recipientPublicKey = await suite.kem.importKey("jwk", jwk);
    const result = await suite.seal({ recipientPublicKey, senderKey: identity.privateKey, info }, bytes, aad(context));
    return { enc: encode(result.enc), ct: encode(result.ct) };
  };
  return { sender: await seal(identity.publicKey), recipient: await seal(peerKey) };
}
export async function decryptMessage(identity: Identity, message: any, peerId: string): Promise<Payload> {
  const own = message.sender_id === identity.userId;
  if ((own ? message.sender_version : message.recipient_version) !== identity.version) throw new Error("This message uses a previous encryption key.");
  const envelopes = JSON.parse(message.envelopes);
  const envelope = own ? envelopes.sender : envelopes.recipient;
  const context = {
    id: message.id,
    conversationId: message.conversation_id,
    senderId: message.sender_id,
    recipientId: own ? peerId : identity.userId,
    senderVersion: message.sender_version,
    recipientVersion: message.recipient_version,
  };
  const senderPublicKey = await suite.kem.importKey("jwk", JSON.parse(message.sender_public_key));
  const bytes = await suite.open(
    { recipientKey: identity.privateKey, senderPublicKey, enc: decode(envelope.enc), info: encoder.encode("Caledon direct message v1") },
    decode(envelope.ct),
    aad(context)
  );
  const payload = JSON.parse(decoder.decode(bytes));
  if (typeof payload.text !== "string" || Array.from(payload.text).length > 5000 || (payload.post && !/^\/p\/[1-9][0-9]*$/.test(payload.post))) throw new Error("Invalid message.");
  return payload;
}
const channel = typeof window !== "undefined" && "BroadcastChannel" in window ? new BroadcastChannel("caledon-dm-lock") : undefined;
channel?.addEventListener("message", (event) => {
  if (!event.data?.userId || event.data.userId === document.body.dataset.viewerId) document.dispatchEvent(new Event("forum:dm-locked"));
});
let database: Promise<IDBDatabase> | undefined;
function deviceDb() {
  return (database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("caledon-dm", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function deviceRequest(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest) {
  const database = await deviceDb();
  return new Promise<any>((resolve, reject) => {
    const tx = database.transaction("keys", mode);
    const request = operation(tx.objectStore("keys"));
    let result: any;
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function rememberIdentity(identity: Identity) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const wrapped = await encryptPrivate(identity.privateKey, key);
  await deviceRequest("readwrite", (store) => store.put({ key, ...wrapped, version: identity.version, publicKey: identity.publicKey }, identity.userId));
}
export async function forgetIdentity(userId?: string) {
  await deviceRequest("readwrite", (store) => (userId ? store.delete(userId) : store.clear()));
  channel?.postMessage({ userId });
}
export async function recalledIdentity(userId: string, version: number, publicKey: JsonWebKey): Promise<Identity | null> {
  const saved = await deviceRequest("readonly", (store) => store.get(userId));
  if (!saved) return null;
  if (saved.version !== version || JSON.stringify(saved.publicKey) !== JSON.stringify(publicKey)) {
    await forgetIdentity(userId);
    return null;
  }
  return { userId, version, publicKey, privateKey: await decryptPrivate(saved, saved.key) };
}
export async function rewrapAccountPassword(currentPassword: string, newPassword: string) {
  const response = await fetch("/api/dm/vault", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not check message keys. Try again.");
  const state = (await response.json()) as { vault: WrappedKey | null };
  if (!state.vault) return undefined;
  return wrapPrivate(await unlockPrivate(state.vault, currentPassword), newPassword);
}
