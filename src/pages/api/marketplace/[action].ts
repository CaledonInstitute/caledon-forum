import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getListing, marketplaceAction } from "../../../lib/marketplace";
import { readLimited } from "../../../lib/security";
import { rateLimit } from "../../../lib/rate-limit";
import { forumError } from "../../../lib/forum-errors";
export const GET: APIRoute = async ({ params }) => {
  const listing = await getListing(params.action || "");
  return listing ? Response.json(listing, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Listing unavailable." }, { status: 404 });
};
export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    if (request.headers.get("origin") !== new URL(env.SITE_URL).origin) return Response.json({ error: "Refresh this page and try again." }, { status: 403 });
    if (!locals.user) return Response.json({ error: "Sign in to continue." }, { status: 401 });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Use a JSON request." }, { status: 415 });
    await rateLimit(`marketplace:${locals.user.id}`, 20);
    const data = JSON.parse(new TextDecoder().decode(await readLimited(new Response(request.body), 64000)));
    return await marketplaceAction(locals.user, params.action || "", data);
  } catch (e) {
    return forumError(e);
  }
};
