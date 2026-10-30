import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { publicProfile } from "../../../../lib/db";
import { profileCardData, profileCardKey } from "../../../../lib/og-card";
import { isValidUsername } from "../../../../lib/usernames";

async function fallback(short = false) {
  const asset = await env.ASSETS.fetch(new URL("/social.png", env.SITE_URL));
  const headers = new Headers(asset.headers);
  headers.set("Cache-Control", `public, max-age=${short ? 60 : 300}`);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(asset.body, { status: asset.status, headers });
}
const missing = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
export const GET: APIRoute = async (ctx) => {
  const username = ctx.params.username || "";
  if (!isValidUsername(username)) return missing();
  const person = await publicProfile(username);
  if (!person) return missing();
  if (username !== person.username) return ctx.redirect(`/api/og/profile/${encodeURIComponent(person.username)}.png${ctx.url.search}`, 301);
  const inPageObject = (ctx.locals.cfContext?.props as { forumPages?: boolean } | undefined)?.forumPages === true;
  if (env.PROFILE_OG_ENABLED !== "true" || env.SERVER_DO_ENABLED !== "true" || !inPageObject) return fallback();
  try {
    const data = profileCardData(person, env.SITE_URL);
    const key = await profileCardKey(data, env.SITE_URL);
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
    const { renderProfileCard } = await import("../../../../lib/og-render");
    const bytes = await renderProfileCard(data);
    const response = new Response(bytes.buffer as ArrayBuffer, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
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
    console.error("Profile social image rendering failed:", error instanceof Error ? error.name : "unknown error");
    return fallback(true);
  }
};
