import { filePolicy, type Attachment, type PrivateAttachment, type UploadPurpose } from "./upload-policy";
const encode = (v: Uint8Array) => btoa(String.fromCharCode(...v));
const decode = (v: string) => Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
export async function uploadRequest(path: string, method: string, body?: BodyInit, signal?: AbortSignal) {
  const response = await fetch(`/api/uploads${path}`, { method, body, signal, headers: typeof body === "string" ? { "Content-Type": "application/json" } : {} });
  const result = (await response.json()) as { error?: string; enabled: boolean; id: string; partBytes: number };
  if (!response.ok) throw new Error(result.error || "Upload failed. Try again.");
  return result;
}
export async function uploadFile(
  file: File,
  purpose: UploadPurpose,
  conversationId: string | undefined,
  signal: AbortSignal,
  onProgress: (value: number) => void,
  onSession: (id: string) => void
): Promise<Attachment | PrivateAttachment> {
  const mime = filePolicy(file.name, file.size, purpose);
  let body: Blob = file,
    privateInfo: { key: string; iv: string } | undefined;
  if (purpose === "dm") {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    body = new Blob([await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await file.arrayBuffer())]);
    privateInfo = { key: encode(new Uint8Array(await crypto.subtle.exportKey("raw", key))), iv: encode(iv) };
  }
  signal.throwIfAborted();
  const session = await uploadRequest("", "POST", JSON.stringify({ name: purpose === "dm" ? "encrypted.bin" : file.name, size: file.size, purpose, conversationId }), signal);
  onSession(session.id);
  for (let offset = 0, part = 1; offset < body.size; offset += session.partBytes, part++) {
    let error: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await uploadRequest(`/${session.id}/${part}`, "PUT", body.slice(offset, offset + session.partBytes), signal);
        error = undefined;
        break;
      } catch (e) {
        error = e;
        if (signal.aborted) throw e;
      }
    }
    if (error) throw error;
    onProgress(Math.round((Math.min(body.size, offset + session.partBytes) / body.size) * 95));
  }
  await uploadRequest(`/${session.id}/complete`, "POST", "{}", signal);
  onProgress(100);
  return { id: session.id, name: file.name, mime, size: file.size, ...privateInfo };
}
export async function decryptAttachment(file: PrivateAttachment, bytes: ArrayBuffer) {
  const key = await crypto.subtle.importKey("raw", decode(file.key), { name: "AES-GCM" }, false, ["decrypt"]);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(file.iv) }, key, bytes);
}
