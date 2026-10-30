import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { control } from "../../../lib/control";
export const GET: APIRoute = async (ctx) => {
  if (env.REALTIME_ENABLED !== "true" || !control()) return new Response(null, { status: 503 });
  if (ctx.request.headers.get("origin") !== new URL(env.SITE_URL).origin) return new Response(null, { status: 403 });
  if (ctx.locals.user?.suspended) return new Response(null, { status: 403 });
  const headers = new Headers({ Upgrade: "websocket", "x-live-ip": ctx.request.headers.get("cf-connecting-ip") || "local" });
  if (ctx.locals.user?.username && ctx.locals.sessionId) {
    headers.set("x-live-user", ctx.locals.user.username);
    headers.set("x-live-session", ctx.locals.sessionId);
  }
  return control()!.fetch(new Request("https://control/connect", { headers }));
};
