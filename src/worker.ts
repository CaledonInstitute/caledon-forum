import { handle } from "@astrojs/cloudflare/handler";
import { env } from "cloudflare:workers";
import { consumePush } from "./lib/push";
import { control } from "./lib/control";
export { ForumControl } from "./worker/control";
export { ForumPages } from "./worker/pages";
export default {
  async fetch(request: Request, _env: Env, context: ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/.internal/")) return new Response(null, { status: 404 });
    if (env.SERVER_DO_ENABLED !== "true") return handle(request, _env, context);
    if (!env.FORUM_PAGES) return new Response("Server temporarily unavailable.", { status: 503 });
    const pages = env.FORUM_PAGES.getByName(`page-${Math.floor(Math.random() * 16)}`);
    try {
      if (path === "/api/live/connect") {
        if (env.REALTIME_ENABLED !== "true" || !control()) return new Response(null, { status: 503 });
        if (request.method !== "GET" || request.headers.get("origin") !== new URL(env.SITE_URL).origin) return new Response(null, { status: 403 });
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response(null, { status: 426 });
        const headers = new Headers({ Upgrade: "websocket", "x-live-ip": request.headers.get("cf-connecting-ip") || "local" });
        if (request.headers.has("cookie")) {
          const auth = await pages.fetch("https://internal/.internal/live-session", { headers: { cookie: request.headers.get("cookie")! } });
          if (!auth.ok) return new Response(null, { status: auth.status });
          const session = (await auth.json()) as { username: string | null; sessionId: string | null };
          if (session.username && session.sessionId) {
            headers.set("x-live-user", session.username);
            headers.set("x-live-session", session.sessionId);
          }
        }
        // WebSockets go directly to the hibernating hub, never through an idle page object.
        return control()!.fetch(new Request("https://control/connect", { headers }));
      }
      const headers = new Headers(request.headers);
      headers.set("x-forum-runtime", "pages");
      return await pages.fetch(new Request(request, { headers }));
    } catch {
      console.error("Forum server temporarily unavailable");
      return new Response("Server temporarily unavailable.", { status: 503, headers: { "Retry-After": "30" } });
    }
  },
  async queue(batch: MessageBatch) {
    await consumePush(batch);
  },
  async scheduled() {
    if (!env.FORUM_PAGES) throw new Error("Maintenance service unavailable");
    const response = await env.FORUM_PAGES.getByName("maintenance").fetch("https://internal/.internal/maintenance");
    if (!response.ok) throw new Error("Maintenance deferred");
  },
};
