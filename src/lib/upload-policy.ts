export const MIB = 1024 * 1024;
export const PART_BYTES = 5 * MIB;
export const MAX_FILES = 4;
export const MAX_TOTAL = 100 * MIB;
export const FILE_TYPES: Record<string, { mime: string; max: number }> = {
  jpg: { mime: "image/jpeg", max: 10 * MIB },
  jpeg: { mime: "image/jpeg", max: 10 * MIB },
  png: { mime: "image/png", max: 10 * MIB },
  gif: { mime: "image/gif", max: 10 * MIB },
  webp: { mime: "image/webp", max: 10 * MIB },
  pdf: { mime: "application/pdf", max: 20 * MIB },
  zip: { mime: "application/zip", max: 20 * MIB },
  txt: { mime: "text/plain", max: 20 * MIB },
  mp4: { mime: "video/mp4", max: 50 * MIB },
  webm: { mime: "video/webm", max: 50 * MIB },
  mp3: { mime: "audio/mpeg", max: 50 * MIB },
  m4a: { mime: "audio/mp4", max: 50 * MIB },
  ogg: { mime: "audio/ogg", max: 50 * MIB },
  wav: { mime: "audio/wav", max: 50 * MIB },
};
export type UploadPurpose = "avatar" | "cover" | "post" | "dm";
export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}
export interface PrivateAttachment extends Attachment {
  key: string;
  iv: string;
}
export const fileUrl = (id: string) => `/api/files/${encodeURIComponent(id)}`;
export function filePolicy(name: string, size: number, purpose: UploadPurpose) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const policy = FILE_TYPES[ext];
  if (!policy) throw new Error("Choose a JPEG, PNG, GIF, WebP, PDF, ZIP, TXT, MP4, WebM, MP3, M4A, OGG, or WAV file.");
  const max = purpose === "avatar" || purpose === "cover" ? 2 * MIB : policy.max;
  if ((purpose === "avatar" || purpose === "cover") && !policy.mime.startsWith("image/")) throw new Error("Choose a JPEG, PNG, GIF, or WebP image.");
  if (!Number.isSafeInteger(size) || size < 1 || size > max) throw new Error(`This file must be between 1 byte and ${max / MIB} MB.`);
  return policy.mime;
}
export function validSignature(bytes: Uint8Array, mime: string) {
  const ascii = new TextDecoder("latin1").decode(bytes.subarray(0, 64));
  switch (mime) {
    case "image/jpeg":
      return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case "image/png":
      return [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
    case "image/gif":
      return /^GIF8[79]a/.test(ascii);
    case "image/webp":
      return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
    case "application/pdf":
      return ascii.startsWith("%PDF-");
    case "application/zip":
      return bytes[0] === 80 && bytes[1] === 75 && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));
    case "video/mp4":
    case "audio/mp4":
      return ascii.slice(4, 8) === "ftyp" && /^(isom|iso[2-9]|mp4[12]|avc1|M4[AVB] |dash|MSNV)/.test(ascii.slice(8, 12));
    case "video/webm":
      return [26, 69, 223, 163].every((b, i) => bytes[i] === b) && ascii.includes("webm");
    case "audio/mpeg":
      return ascii.startsWith("ID3") || (bytes[0] === 255 && (bytes[1] & 224) === 224);
    case "audio/ogg":
      return ascii.startsWith("OggS");
    case "audio/wav":
      return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE";
    case "text/plain":
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
        return !bytes.includes(0);
      } catch {
        return false;
      }
    default:
      return false;
  }
}
export function attachmentList(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_FILES || value.some((v) => typeof v !== "string" || !/^[0-9a-f-]{36}$/.test(v)) || new Set(value).size !== value.length)
    throw new Error("Choose up to four different attachments.");
  return value;
}
