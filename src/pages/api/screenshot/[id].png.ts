import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { publicPost, previews } from "../../../lib/db";
import { postCardData } from "../../../lib/og-card";
import { normalizePreviews } from "../../../lib/preview-normalization";
import { rateLimit } from "../../../lib/rate-limit";
import { forumError } from "../../../lib/forum-errors";

export const GET: APIRoute = async (ctx) => {
  try {
    const p = await publicPost(ctx.params.id || "");
    if (!p || p.deleted) return new Response(null, { status: 404 });
    await rateLimit(`screenshot:${ctx.locals.user?.id || ctx.request.headers.get("cf-connecting-ip") || "local"}`, 20);
    const data = postCardData(p, normalizePreviews(await previews(p.id)), env.SITE_URL);
    const { renderPostCard } = await import("../../../lib/og-render");
    const bytes = await renderPostCard(data, true);
    return new Response(bytes.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="caledon-${p.publicId}-1080x1920.png"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return forumError(error);
  }
};
