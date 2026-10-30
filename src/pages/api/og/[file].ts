import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { publicPost, previews } from "../../../lib/db";
import { postCardData, postCardKey } from "../../../lib/og-card";
import { normalizePreviews } from "../../../lib/previews";

async function fallback(short = false) {
  const asset = await env.ASSETS.fetch(new URL("/social.png", env.SITE_URL));
  const headers = new Headers(asset.headers);
  headers.set("Cache-Control", `public, max-age=${short ? 60 : 300}`);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(asset.body, { status: asset.status, headers });
}
export const GET: APIRoute = async (ctx) => {
  const file = ctx.params.file || "";
  if (file === "site.png") return fallback();
  if (!/^[0-9]{1,19}\.png$/.test(file)) return new Response(null, { status: 404 });
  const id = file.slice(0, -4);
  const p = await publicPost(id);
  if (!p || p.deleted) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (id !== String(p.publicId)) return ctx.redirect(`/api/og/${p.publicId}.png${ctx.url.search}`, 301);
  const inPageObject = (ctx.locals.cfContext?.props as { forumPages?: boolean } | undefined)?.forumPages === true;
  if (env.POST_OG_ENABLED !== "true" || env.SERVER_DO_ENABLED !== "true" || !inPageObject) return fallback();
  try {
    const data = postCardData(p, normalizePreviews(await previews(p.id)), env.SITE_URL);
    const key = await postCardKey(data, env.SITE_URL);
    let cache: Cache | undefined;
    try {
      cache = await caches.open("social-images");
      const hit = await cache.match(key);
      if (hit) {
        const headers = new Headers(hit.headers);
        headers.set("Cache-Control", "public, max-age=300");
        return new Response(hit.body, { headers });
      }
    } catch {
      /* Cache availability must not determine render availability. */
    }
    const { renderPostCard } = await import("../../../lib/og-render");
    const bytes = await renderPostCard(data);
    const response = new Response(bytes.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
    if (cache) {
      const cached = response.clone();
      cached.headers.set("Cache-Control", "public, max-age=3600");
      try {
        await cache.put(key, cached);
      } catch {
        /* Serve freshly rendered PNG. */
      }
    }
    return response;
  } catch (error) {
    console.error("Social image rendering failed:", error instanceof Error ? error.name : "unknown error");
    return fallback(true);
  }
};
