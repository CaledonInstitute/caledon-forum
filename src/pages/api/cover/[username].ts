import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { one } from "../../../lib/db";
import { fetchAvatar } from "../../../lib/avatar";

export const GET: APIRoute = async (ctx) => {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  const user = await one<{ cover_image: string | null }>("SELECT cover_image FROM user WHERE username=? AND deleting_at IS NULL", ctx.params.username);
  if (!user?.cover_image) return new Response("Image not found", { status: 404, headers });
  const parsed = new URL(user.cover_image);
  if (parsed.origin === new URL(env.SITE_URL).origin && /^\/api\/files\/[0-9a-f-]{36}$/.test(parsed.pathname))
    return new Response(null, { status: 307, headers: { ...headers, Location: parsed.pathname } });
  try {
    const { bytes, type } = await fetchAvatar(user.cover_image, "Cover photo");
    return new Response(bytes.buffer as ArrayBuffer, { headers: { ...headers, "Content-Type": type } });
  } catch {
    return new Response("Image unavailable", { status: 502, headers });
  }
};
