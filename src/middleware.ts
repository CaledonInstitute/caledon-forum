import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { authReady, createAuth } from "./lib/auth";
import { one, run } from "./lib/db";
import { refreshMembership } from "./lib/membership";
import type { Viewer } from "./lib/types";
export const onRequest = defineMiddleware(async (ctx, next) => {
  ctx.locals.user = null;
  const bearerRoute = ctx.url.pathname === "/api/v1" || ctx.url.pathname.startsWith("/api/v1/");
  if (!bearerRoute && authReady() && ctx.request.headers.has("cookie")) {
    const session = await createAuth().api.getSession({ headers: ctx.request.headers });
    if (session) {
      ctx.locals.sessionId = session.session.id;
      ctx.locals.user = await one<Viewer>(
        "SELECT id,username,name,email_verified AS emailVerified,image,cover_image AS coverImage,bio,location,role,suspended FROM user WHERE id=?",
        session.user.id
      );
      if (ctx.locals.user && !ctx.url.pathname.startsWith("/api/auth/"))
        await run("UPDATE user SET last_active_at=? WHERE id=? AND (last_active_at IS NULL OR last_active_at<?)", Date.now(), ctx.locals.user.id, Date.now() - 60000);
      if (!ctx.url.pathname.startsWith("/api/auth/")) await refreshMembership(session.user.id);
    }
  }
  const original = await next();
  if (original.webSocket) return original;
  const response = new Response(original.body, original);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (
    ctx.url.pathname.startsWith("/dm") ||
    ctx.url.pathname.startsWith("/api/auth/") ||
    ["/login", "/register", "/verify", "/forgot-password", "/reset-password", "/settings", "/notifications", "/admin"].includes(ctx.url.pathname) ||
    [...ctx.url.searchParams.keys()].some((key) => /token|code|state|password|email|signature|key/i.test(key))
  )
    response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  const socketOrigin = new URL(env.SITE_URL);
  socketOrigin.protocol = socketOrigin.protocol === "https:" ? "wss:" : "ws:";
  response.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ${socketOrigin.origin} https://challenges.cloudflare.com https://cloudflareinsights.com; frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`
  );
  if (
    ctx.url.pathname === "/dm" ||
    ctx.url.pathname.startsWith("/dm/") ||
    ctx.url.pathname.startsWith("/api/") ||
    ["/settings", "/notifications", "/admin", "/login", "/register", "/verify", "/forgot-password", "/reset-password", "/onboarding", "/search"].some((p) => ctx.url.pathname === p)
  )
    response.headers.set("X-Robots-Tag", "noindex");
  if (
    ctx.locals.user ||
    bearerRoute ||
    ctx.url.pathname.startsWith("/api/account/") ||
    ctx.url.pathname.startsWith("/dm") ||
    ctx.url.pathname.startsWith("/api/auth/") ||
    ["/settings", "/notifications", "/admin"].includes(ctx.url.pathname)
  )
    response.headers.set("Cache-Control", "private, no-store");
  return response;
});
