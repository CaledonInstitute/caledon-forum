import { Buffer } from "node:buffer";
import { env } from "cloudflare:workers";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm?module";
import regular from "@fontsource/manrope/files/manrope-latin-400-normal.woff?inline";
import bold from "@fontsource/manrope/files/manrope-latin-700-normal.woff?inline";
import { socialSvg, profileSocialSvg } from "./og";
import { cardImage, type PostCardData, type ProfileCardData } from "./og-card";
let ready: Promise<void> | undefined;
const decode = (value: string) => Uint8Array.from(Buffer.from(value.split(",")[1], "base64")).buffer;
let fonts: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer; emoji: ArrayBuffer }> | undefined;
async function loadFonts() {
  const asset = await env.ASSETS.fetch(new URL("/fonts/noto-emoji.woff", env.SITE_URL));
  if (!asset.ok) throw new Error("Bundled emoji font unavailable");
  return { regular: decode(regular), bold: decode(bold), emoji: await asset.arrayBuffer() };
}
async function prepareRenderer() {
  ready ||= initWasm(wasm).catch((error) => {
    ready = undefined;
    throw error;
  });
  await ready;
  fonts ||= loadFonts().catch((error) => {
    fonts = undefined;
    throw error;
  });
  return fonts;
}
export async function renderPostCard(data: PostCardData) {
  const loadedFonts = await prepareRenderer();
  const signal = AbortSignal.timeout(3000);
  const [avatar, media] = await Promise.all([cardImage(data.avatar, 2 * 1024 * 1024, signal), cardImage(data.media, 10 * 1024 * 1024, signal)]);
  try {
    return rasterize(await socialSvg(loadedFonts, data, avatar, media));
  } catch (error) {
    if (!avatar && !media) throw error;
    return rasterize(await socialSvg(loadedFonts, data));
  }
}
export async function renderProfileCard(data: ProfileCardData) {
  const loadedFonts = await prepareRenderer();
  const signal = AbortSignal.timeout(3000);
  const [avatar, cover] = await Promise.all([cardImage(data.avatar, 2 * 1024 * 1024, signal), cardImage(data.cover, 2 * 1024 * 1024, signal)]);
  try {
    return rasterize(await profileSocialSvg(loadedFonts, data, avatar, cover));
  } catch (error) {
    if (!avatar && !cover) throw error;
    return rasterize(await profileSocialSvg(loadedFonts, data));
  }
}
function rasterize(svg: string) {
  const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
  try {
    const image = renderer.render();
    try {
      return image.asPng();
    } finally {
      image.free();
    }
  } finally {
    renderer.free();
  }
}
