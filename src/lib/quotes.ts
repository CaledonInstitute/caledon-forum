import { env } from "cloudflare:workers";
import { load } from "cheerio";
import { publicPost } from "./db";
import { extractLinks, markdown } from "./markdown";
import { excerpt } from "./content";
import type { QuotedPost } from "./types";

export function localPostId(value: string): string | null {
  try {
    const url = new URL(value, env.SITE_URL);
    if (url.origin !== new URL(env.SITE_URL).origin || url.username || url.password) return null;
    return /^\/p\/([0-9]{1,19})\/?$/.exec(url.pathname)?.[1] || null;
  } catch {
    return null;
  }
}

export async function quotedPost(body: string): Promise<QuotedPost | null> {
  for (const sourceUrl of extractLinks(body, false)) {
    const id = localPostId(sourceUrl);
    if (!id) continue;
    const p = await publicPost(id);
    if (!p || p.deleted) return { sourceUrl, url: `/p/${id}`, unavailable: true };
    const text = load(await markdown(p.body)).text();
    return {
      sourceUrl,
      url: `/p/${p.publicId}`,
      unavailable: false,
      name: p.name,
      username: p.username,
      image: p.image,
      isCaledonMember: !!p.isCaledonMember,
      text: excerpt(text, 320),
      createdAt: p.createdAt,
      parentUsername: p.parentUsername,
    };
  }
  return null;
}
