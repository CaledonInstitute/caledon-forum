import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { one, run } from "../../lib/db";
import { pushReady, subscriptionId, validateSubscription } from "../../lib/push";
import { readLimited } from "../../lib/security";
import { rateLimit } from "../../lib/rate-limit";
import { forumError } from "../../lib/forum-errors";
export const ALL: APIRoute = async (ctx) => {
  if (!ctx.locals.user || ctx.locals.user.suspended) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (ctx.request.method === "GET") {
    const device = ctx.cookies?.get("push-device")?.value;
    const active = device && /^[a-f0-9]{64}$/.test(device) ? await one("SELECT id FROM push_subscriptions WHERE id=? AND user_id=?", device, ctx.locals.user.id) : null;
    return Response.json(
      {
        enabled: pushReady(),
        deviceSubscribed: !!active,
        publicKey: pushReady() ? env.VAPID_PUBLIC_KEY : null,
        preferences: (await one('SELECT reply,mention,"like" FROM push_preferences WHERE user_id=?', ctx.locals.user.id)) || { reply: 1, mention: 1, like: 1 },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }
  try {
    if (ctx.request.headers.get("origin") !== new URL(env.SITE_URL).origin) return new Response(null, { status: 403 });
    if (!["POST", "DELETE", "PATCH"].includes(ctx.request.method)) return new Response(null, { status: 405 });
    if (!ctx.request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 415 });
    await rateLimit(`push:${ctx.locals.user.id}`, 10);
    const data = JSON.parse(new TextDecoder().decode(await readLimited(new Response(ctx.request.body), 8192)));
    if (ctx.request.method === "DELETE") {
      if (typeof data.endpoint !== "string" || data.endpoint.length > 2048) return new Response(null, { status: 400 });
      await run("DELETE FROM push_subscriptions WHERE id=? AND user_id=?", await subscriptionId(data.endpoint), ctx.locals.user.id);
      ctx.cookies.delete("push-device", { path: "/" });
    } else if (ctx.request.method === "PATCH") {
      if (["reply", "mention", "like"].some((key) => typeof data[key] !== "boolean")) return new Response(null, { status: 400 });
      await run(
        'INSERT INTO push_preferences(user_id,reply,mention,"like") VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET reply=excluded.reply,mention=excluded.mention,"like"=excluded."like"',
        ctx.locals.user.id,
        +data.reply,
        +data.mention,
        +data.like
      );
    } else {
      if (!pushReady()) return Response.json({ error: "Browser notifications are not available yet." }, { status: 503 });
      const s = validateSubscription(data);
      const id = await subscriptionId(s.endpoint);
      const existing = await one<{ user_id: string }>("SELECT user_id FROM push_subscriptions WHERE id=?", id);
      if (existing && existing.user_id !== ctx.locals.user.id)
        return Response.json({ error: "Disable notifications for the previous account on this browser first." }, { status: 409 });
      const result = await run(
        `INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM push_subscriptions WHERE user_id=?)<3 OR EXISTS(SELECT 1 FROM push_subscriptions WHERE id=? AND user_id=?) ON CONFLICT(id) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth WHERE push_subscriptions.user_id=excluded.user_id`,
        id,
        ctx.locals.user.id,
        s.endpoint,
        s.p256dh,
        s.auth,
        Date.now(),
        ctx.locals.user.id,
        id,
        ctx.locals.user.id
      );
      if (!result.meta.changes) return Response.json({ error: "Maximum three devices per account." }, { status: 409 });
      ctx.cookies.set("push-device", id, { path: "/", httpOnly: true, secure: ctx.url.protocol === "https:", sameSite: "strict", maxAge: 365 * 86400 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return forumError(error);
  }
};
