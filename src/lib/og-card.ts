import { Buffer } from "node:buffer";
import { load } from "cheerio";
import { safeFetch, readLimited, rasterType } from "./security";
import type { ForumPost, LinkPreview, PublicProfile } from "./types";

export const OG_DESIGN_VERSION = "post-v1.3";
export const PROFILE_OG_DESIGN_VERSION = "profile-v2";
export function profileCardData(person: PublicProfile, origin: string) {
  return {
    name: person.name,
    username: person.username,
    avatar: person.image,
    cover: person.coverImage,
    member: !!person.isCaledonMember,
    bio: person.bio.replace(/\s+/g, " ").trim(),
    host: new URL(origin).host,
  };
}
export type ProfileCardData = ReturnType<typeof profileCardData>;
export async function profileCardKey(data: ProfileCardData, origin: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(data)));
  return new Request(new URL(`/api/og/profile/${encodeURIComponent(data.username)}.png?v=${PROFILE_OG_DESIGN_VERSION}-${Buffer.from(hash).toString("hex")}`, origin));
}
export function truncateCardText(value: string, limit: number) {
  const chars = Array.from(value);
  return chars.length > limit
    ? chars
        .slice(0, limit - 1)
        .join("")
        .trimEnd() + "…"
    : value;
}
export function postCardData(p: ForumPost, links: LinkPreview[], origin: string) {
  const media = links.find((link) => link.kind === "image");
  const raw = p.body.replace(/```[^\n]*\n([\s\S]*?)```/g, "$1").replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  const text = load(raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ""), null, false)
    .text()
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(^|\n)\s{0,3}#{1,6}\s/g, "$1")
    .replace(/[*_`~>]/g, "")
    .replaceAll(media?.url || "\u0000", "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    id: p.publicId,
    name: p.name,
    username: p.username,
    avatar: p.image,
    member: !!p.isCaledonMember,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    text,
    parent: p.parentUsername || null,
    media: media?.image || media?.url || null,
    host: new URL(origin).host,
  };
}
export type PostCardData = ReturnType<typeof postCardData>;
export async function postCardKey(data: PostCardData, origin: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(data)));
  return new Request(new URL(`/api/og/${data.id}.png?v=${OG_DESIGN_VERSION}-${Buffer.from(hash).toString("hex")}`, origin));
}
export async function cardImage(url: string | null, max: number, signal: AbortSignal): Promise<string | undefined> {
  if (!url) return;
  try {
    const response = await safeFetch(url, "image/png,image/jpeg,image/gif,image/webp", fetch, signal);
    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const bytes = await readLimited(response, max);
    if (!rasterType(bytes, type)) return;
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return;
  }
}
export function cardText(text: string, withImage: boolean) {
  const limit = withImage ? 240 : 540;
  const chars = Array.from(text);
  return chars.length > limit
    ? chars
        .slice(0, limit - 1)
        .join("")
        .trimEnd() + "…"
    : text;
}
