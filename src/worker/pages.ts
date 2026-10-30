import { DurableObject } from "cloudflare:workers";
import { handle } from "@astrojs/cloudflare/handler";
import { authReady, createAuth } from "../lib/auth";
import { dispatchPush } from "../lib/push";
/** The browser renders rich content. This guards remaining Astro/API CPU on Free. */
export class ForumPages extends DurableObject<Cloudflare.Env> {
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === "/.internal/live-session") {
      if (!authReady()) return Response.json({ username: null, sessionId: null });
      const session = await createAuth().api.getSession({ headers: request.headers });
      if (!session) return Response.json({ username: null, sessionId: null });
      const user = await this.env.DB.prepare("SELECT username,suspended FROM user WHERE id=?").bind(session.user.id).first<{ username: string | null; suspended: number }>();
      if (user?.suspended) return new Response(null, { status: 403 });
      return Response.json({ username: user?.username || null, sessionId: user?.username ? session.session.id : null });
    }
    if (path === "/.internal/maintenance") {
      const now = Date.now();
      await this.env.DB.batch([
        this.env.DB.prepare("DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE reset_at<? LIMIT 200)").bind(now),
        this.env.DB.prepare("DELETE FROM push_outbox WHERE notification_id IN (SELECT notification_id FROM push_outbox WHERE expires_at<? LIMIT 100)").bind(now),
        this.env.DB.prepare("DELETE FROM push_daily WHERE day<?").bind(new Date(now - 2 * 86400000).toISOString().slice(0, 10)),
        this.env.DB.prepare("UPDATE push_deliveries SET state='pending',queued_at=NULL WHERE state='sending' AND queued_at<?").bind(now - 600000),
      ]);
      await dispatchPush();
      return new Response(null, { status: 204 });
    }
    const context = {
      waitUntil: (promise: Promise<unknown>) => this.ctx.waitUntil(promise),
      passThroughOnException() {},
      props: { forumPages: true },
    } as unknown as ExecutionContext;
    return handle(request, this.env as Env, context);
  }
}
