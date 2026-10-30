import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm?module";
import fontData from "@fontsource/manrope/files/manrope-latin-400-normal.woff?inline";
import { socialSvg } from "../../../lib/og";
import { publicPost, previews } from "../../../lib/db";
import { threadTitle } from "../../../lib/content";
let ready: Promise<void> | undefined;
let font: Promise<ArrayBuffer> | undefined;
export const GET: APIRoute = async (ctx) => {
  const file = ctx.params.file || "";
  if (!file.endsWith(".png")) return new Response(null, { status: 404 });
  const id = file.slice(0, -4);
  const p = id === "site" ? null : await publicPost(id);
  if (id !== "site" && (!p || p.deleted)) return new Response(null, { status: 404 });
  if (env.STATIC_OG_ENABLED === "true") return env.ASSETS.fetch(new URL("/social.png", env.SITE_URL));
  if (p && id !== String(p.publicId)) return ctx.redirect(`/api/og/${p.publicId}.png${ctx.url.search}`, 301);
  const key = new Request(new URL(`/api/og/${file}${p ? `?v=${p.updatedAt}` : ""}`, env.SITE_URL));
  const cache = await caches.open("social-images");
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    ready ||= initWasm(wasm);
    await ready;
    font ||= Promise.resolve(Uint8Array.from(atob(fontData.split(",")[1]), (c) => c.charCodeAt(0)).buffer);
    const links = p ? await previews(p.id) : [];
    const svg = await socialSvg(
      await font,
      p ? threadTitle(p.body, links.find((l) => l.kind !== "image")?.title, p.name) : "Good conversations start with a little curiosity.",
      p?.name
    );
    const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
    const image = renderer.render();
    const bytes = image.asPng();
    image.free();
    renderer.free();
    const response = new Response(bytes.buffer as ArrayBuffer, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" },
    });
    await cache.put(key, response.clone());
    return response;
  } catch (error) {
    console.error("Social image rendering failed:", error instanceof Error ? error.message : "unknown error");
    return env.ASSETS.fetch(new URL("/social.png", env.SITE_URL));
  }
};
