import { load } from "cheerio";
import { one, run, db } from "./db";
import { extractUrls } from "./markdown";
import { publicUrl, safeFetch, readLimited, rasterType } from "./security";
import { youtubeId } from "./content";
import type { LinkPreview } from "./types";
import { localPostId } from "./quotes";
import { env } from "cloudflare:workers";
import { reserveBudget } from "./control";
const query = "SELECT id,url,kind,title,description,site,image,video_id AS videoId,checked_at AS checkedAt FROM link_previews WHERE url=?";
import { mediaPathKind } from "./preview-normalization";
export { normalizePreview, normalizePreviews } from "./preview-normalization";
const IMAGE_ACCEPT = "image/webp,image/png,image/jpeg,image/gif";
const clean = (s: string, max = 300) =>
  s
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
function previewUsable(p: LinkPreview, url: string) {
  const pathKind = mediaPathKind(url);
  if (pathKind === "video_audio") return false;
  if (pathKind === "image") return p.kind === "image";
  return true;
}
async function inspectImage(url: string, p: LinkPreview): Promise<LinkPreview | null> {
  const response = await safeFetch(url, IMAGE_ACCEPT);
  const type = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!type.startsWith("image/")) {
    await response.body?.cancel();
    return null;
  }
  const bytes = await readLimited(response, 10 * 1024 * 1024);
  if (!rasterType(bytes, type)) return null;
  p.kind = "image";
  p.image = url;
  return p;
}
async function scrapeLink(url: string, response: Response, p: LinkPreview): Promise<LinkPreview> {
  const $ = load(new TextDecoder().decode(await readLimited(response, 1024 * 1024)));
  const meta = (key: string) => $(`meta[property="${key}"],meta[name="${key}"]`).first().attr("content") || "";
  p.title = clean(meta("og:title") || meta("twitter:title") || $("title").first().text());
  p.description = clean(meta("og:description") || meta("twitter:description") || meta("description"));
  p.site = clean(meta("og:site_name") || p.site, 100);
  const image = meta("og:image") || meta("twitter:image");
  if (image) {
    try {
      p.image = publicUrl(new URL(image, url).href).href;
    } catch {}
  }
  return p;
}
export async function inspectLink(value: string): Promise<LinkPreview | null> {
  try {
    if (localPostId(value)) return null;
    const url = publicUrl(value).href;
    const cached = await one<LinkPreview>(query, url);
    if (cached && cached.checkedAt > Date.now() - 86400000 && previewUsable(cached, url)) return cached;
    let p: LinkPreview = {
      id: cached?.id || crypto.randomUUID(),
      url,
      kind: "link",
      title: "",
      description: "",
      site: new URL(url).hostname,
      image: null,
      videoId: null,
      checkedAt: Date.now(),
    };
    const key = `link:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url))), (n) => n.toString(16).padStart(2, "0")).join("")}`;
    let shared: LinkPreview | null = null;
    try {
      shared = (await env.PUBLIC_METADATA?.get<LinkPreview>(key, "json")) || null;
    } catch {
      /* D1/fetch remain available. */
    }
    if (shared?.url === url && shared.checkedAt > Date.now() - 86400000 && previewUsable(shared, url)) {
      p = { ...shared, id: cached?.id || shared.id };
    } else {
      const vid = youtubeId(url);
      if (vid) {
        const response = await safeFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${vid}`)}`);
        const data = JSON.parse(new TextDecoder().decode(await readLimited(response, 100000)));
        p = {
          ...p,
          kind: "youtube",
          title: clean(data.title || ""),
          site: clean(data.author_name || "YouTube"),
          image: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
          videoId: vid,
        };
      } else {
        const pathKind = mediaPathKind(url);
        // Linked video/audio must stay plain links — never SEO cards.
        if (pathKind === "video_audio") return null;
        if (pathKind === "image") {
          const image = await inspectImage(url, p);
          if (!image) return null;
          p = image;
        } else {
          const response = await safeFetch(url);
          const type = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
          if (type.startsWith("image/")) {
            const bytes = await readLimited(response, 10 * 1024 * 1024);
            if (!rasterType(bytes, type)) return null;
            p.kind = "image";
            p.image = url;
          } else if (type.startsWith("video/") || type.startsWith("audio/")) {
            await response.body?.cancel();
            return null;
          } else {
            if (!["text/html", "application/xhtml+xml"].includes(type)) {
              await response.body?.cancel();
              return null;
            }
            p = await scrapeLink(url, response, p);
          }
        }
      }
    }
    await run(
      `INSERT INTO link_previews(id,url,kind,title,description,site,image,video_id,checked_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET kind=excluded.kind,title=excluded.title,description=excluded.description,site=excluded.site,image=excluded.image,video_id=excluded.video_id,checked_at=excluded.checked_at`,
      p.id,
      p.url,
      p.kind,
      p.title,
      p.description,
      p.site,
      p.image,
      p.videoId,
      p.checkedAt
    );
    try {
      if (env.PUBLIC_METADATA && (await reserveBudget("kv-writes", 500))) await env.PUBLIC_METADATA.put(key, JSON.stringify(p), { expirationTtl: 86400 });
    } catch {
      /* Optional cache. */
    }
    return await one<LinkPreview>(query, url);
  } catch {
    return null;
  }
}
export async function inspectBody(body: string) {
  const result: LinkPreview[] = [];
  let card = false;
  // Bounded concurrency avoids multiplying slow remote requests.
  const urls = extractUrls(body);
  for (let i = 0; i < urls.length; i += 4) {
    const batch = await Promise.all(urls.slice(i, i + 4).map(inspectLink));
    for (const p of batch)
      if (p && (p.kind === "image" || !card)) {
        result.push(p);
        if (p.kind !== "image") card = true;
      }
  }
  return result;
}
export async function attachPreviews(postId: string, links: LinkPreview[]) {
  await db().batch([
    db().prepare("DELETE FROM post_links WHERE post_id=?").bind(postId),
    ...links.map((p, i) => db().prepare("INSERT OR IGNORE INTO post_links(post_id,preview_id,position) VALUES(?,?,?)").bind(postId, p.id, i)),
  ]);
}
