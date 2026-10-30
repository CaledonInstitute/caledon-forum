import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { dmAction } from "../../../lib/dm-service";
import { rateLimit } from "../../../lib/rate-limit";
import { readLimited } from "../../../lib/security";
import { forumError } from "../../../lib/forum-errors";
export const ALL: APIRoute = async (ctx) => {
  try {
    const user = ctx.locals.user;
    if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401 });
    const write = ctx.request.method === "POST";
    if (!write && ctx.request.method !== "GET") return new Response(null, { status: 405 });
    if (write && (ctx.request.headers.get("origin") !== new URL(env.SITE_URL).origin || !ctx.request.headers.get("content-type")?.startsWith("application/json")))
      return new Response(null, { status: 403 });
    const action = ctx.params.action!;
    await rateLimit(`dm:${user.id}:${action}`, action === "send" ? 30 : action === "vault" && write ? 5 : 120);
    const data = write ? JSON.parse(new TextDecoder().decode(await readLimited(new Response(ctx.request.body), 100000))) : Object.fromEntries(ctx.url.searchParams);
    return Response.json(await dmAction(user, action, data, write), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return forumError(error);
  }
};
