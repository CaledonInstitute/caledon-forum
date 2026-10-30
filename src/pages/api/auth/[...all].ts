import type { APIRoute } from "astro";
import { authReady, createAuth } from "../../../lib/auth";
import { rateLimit } from "../../../lib/rate-limit";
import { run } from "../../../lib/db";
import { env } from "cloudflare:workers";
import { readLimited } from "../../../lib/security";
// OAuth tokens and email sign-in are deliberately not exposed as browser capabilities.
const allowed = new Set([
  "/sign-in/social",
  "/sign-in/username",
  "/sign-up/email",
  "/request-password-reset",
  "/reset-password",
  "/send-verification-email",
  "/verify-email",
  "/link-social",
  "/unlink-account",
  "/change-password",
  "/sign-out",
  "/get-session",
  "/callback/github",
  "/callback/google",
  "/list-accounts",
]);
export const ALL: APIRoute = async (ctx) => {
  if (!authReady()) return Response.json({ message: "Sign-in is not available yet. Please check back soon." }, { status: 503 });
  const route = "/" + (ctx.params.all || "").replace(/\/+$/, "");
  if (!allowed.has(route) && !(ctx.request.method === "GET" && /^\/reset-password\/[A-Za-z0-9_-]+$/.test(route)))
    return Response.json({ message: "This action is unavailable." }, { status: 404 });
  try {
    if (ctx.request.method === "POST") {
      await rateLimit(`auth:${ctx.request.headers.get("cf-connecting-ip") || "local"}:${route}`, route.includes("sign-in") ? 10 : 5, 600000);
      if (ctx.locals.user?.suspended && route !== "/sign-out") return Response.json({ message: "This account is suspended." }, { status: 403 });
    }
    if (route === "/unlink-account" && ctx.request.method === "POST") {
      if (!ctx.locals.user) return Response.json({ message: "Sign in to continue." }, { status: 401 });
      if (ctx.request.headers.get("origin") !== new URL(env.SITE_URL).origin) return Response.json({ message: "Refresh this page and try again." }, { status: 403 });
      if (!ctx.request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ message: "Use a JSON request." }, { status: 415 });
      const data = JSON.parse(new TextDecoder().decode(await readLimited(new Response(ctx.request.body), 2048)));
      if (!["github", "google"].includes(data?.providerId)) return Response.json({ message: "Select a social sign-in method." }, { status: 400 });
      // The existence check and delete must be one statement: concurrent unlink requests
      // must never remove the last remaining sign-in method.
      const result = await run(
        "DELETE FROM account AS target WHERE target.user_id=? AND target.id=(SELECT id FROM account WHERE user_id=? AND provider_id=? LIMIT 1) AND EXISTS(SELECT 1 FROM account other WHERE other.user_id=target.user_id AND other.id<>target.id)",
        ctx.locals.user.id,
        ctx.locals.user.id,
        data.providerId
      );
      if (!result.meta.changes) return Response.json({ message: "Add another sign-in method before disconnecting this account." }, { status: 400 });
      if (data.providerId === "github")
        await run(
          "DELETE FROM memberships WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM account WHERE user_id=? AND provider_id=?)",
          ctx.locals.user.id,
          ctx.locals.user.id,
          "github"
        );
      return Response.json({ status: true });
    }
    let emailFailed = false;
    const sendsEmail = ["/sign-up/email", "/sign-in/username", "/request-password-reset", "/send-verification-email"].includes(route);
    const response = await createAuth(
      sendsEmail
        ? () => {
            emailFailed = true;
          }
        : undefined
    ).handler(ctx.request);
    if (emailFailed) {
      // Signup has already persisted the account, even when delivery fails.
      if (route === "/sign-up/email" && response.ok) {
        const body = (await response.json()) as Record<string, unknown>;
        return Response.json({ ...body, emailDelivery: "failed" }, { status: response.status, headers: response.headers });
      }
      return Response.json({ message: "We could not send the email. Please try again later. If this continues, contact the forum administrator." }, { status: 503 });
    }
    if (route === "/sign-out" && ctx.request.method === "POST" && response.ok && ctx.locals.user) {
      const device = ctx.cookies?.get("push-device")?.value;
      if (device && /^[a-f0-9]{64}$/.test(device)) await run("DELETE FROM push_subscriptions WHERE id=? AND user_id=?", device, ctx.locals.user.id);
      ctx.cookies?.delete("push-device", { path: "/" });
    }
    if (route === "/callback/github" && response.status < 400) {
      // Invalidate any cached status; the redirected page verifies the current linked identity.
      if (ctx.locals.user) await run("UPDATE memberships SET checked_at=0,retry_after=0 WHERE user_id=?", ctx.locals.user.id);
    }
    return response;
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ message: "Unable to complete sign-in. Please try again." }, { status: 500 });
  }
};
