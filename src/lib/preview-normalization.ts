import type { LinkPreview } from "./types";
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const VIDEO_AUDIO_EXT = /\.(mp4|webm|mov|m4v|mp3|m4a|ogg|wav|aac)$/i;
/** Pathname-only media hint; query strings (e.g. Discord signatures) are ignored. */
export function mediaPathKind(value: string): "image" | "video_audio" | null {
  try {
    const path = new URL(value).pathname;
    if (IMAGE_EXT.test(path)) return "image";
    if (VIDEO_AUDIO_EXT.test(path)) return "video_audio";
  } catch {
    /* Invalid URL. */
  }
  return null;
}
/** Drop/coerce previews misclassified before image Accept / media-path checks. */
export function normalizePreview(p: LinkPreview): LinkPreview | null {
  const pathKind = mediaPathKind(p.url);
  if (pathKind === "video_audio") return null;
  if (pathKind === "image" && p.kind !== "image") {
    return { ...p, kind: "image", image: p.url, title: "", description: "" };
  }
  return p;
}
export function normalizePreviews(list: LinkPreview[]) {
  return list.flatMap((p) => {
    const n = normalizePreview(p);
    return n ? [n] : [];
  });
}
