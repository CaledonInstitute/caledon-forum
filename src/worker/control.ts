import { DurableObject } from "cloudflare:workers";
type Attachment = { ip: string; username: string | null; sessionId: string | null; expires: number; users: string[]; lastMessage: number; lastPresence?: string };
export class ForumControl extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS counters(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL)");
  }
  private take(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const row = this.ctx.storage.sql
      .exec<{ count: number }>(
        `INSERT INTO counters(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING count`,
        key,
        now + windowMs,
        now,
        now
      )
      .one();
    return row.count <= limit;
  }
  private daily(kind: string, limit: number) {
    return this.take(`daily:${new Date().toISOString().slice(0, 10)}:${kind}`, limit, 2 * 86400000);
  }
  private sockets() {
    return this.ctx.getWebSockets();
  }
  private online(users: string[]) {
    const active = new Set(
      this.sockets()
        .map((ws) => ws.deserializeAttachment() as Attachment)
        .filter((a) => a.expires > Date.now())
        .map((a) => a.username)
    );
    return Object.fromEntries(users.map((name) => [name, active.has(name)]));
  }
  private send(ws: WebSocket, value: unknown) {
    if (!this.daily("events", 20000)) {
      ws.close(1013, "Daily realtime budget reached");
      return;
    }
    try {
      ws.send(JSON.stringify(value));
    } catch {
      /* Disconnected. */
    }
  }
  private presence(ws: WebSocket, a: Attachment) {
    const users = this.env.PRESENCE_ENABLED === "true" ? this.online(a.users) : {};
    const serialized = JSON.stringify(users);
    if (serialized === a.lastPresence) return;
    a.lastPresence = serialized;
    ws.serializeAttachment(a);
    this.send(ws, { type: "presence", users });
  }
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === "/push-delivery") {
      const { processPushBatch } = await import("../lib/push");
      let retry = false;
      const message = {
        body: await request.json(),
        ack() {},
        retry() {
          retry = true;
        },
      };
      await processPushBatch({ messages: [message] } as unknown as MessageBatch);
      return new Response(null, { status: retry ? 503 : 204 });
    }
    if (path === "/limit") {
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 60000);
      const { key, limit, windowMs } = (await request.json()) as { key: string; limit: number; windowMs: number };
      return new Response(null, { status: this.take(key, limit, windowMs) ? 204 : 429 });
    }
    if (path === "/budget") {
      const { kind, limit } = (await request.json()) as { kind: string; limit: number };
      return new Response(null, { status: this.daily(kind, limit) ? 204 : 429 });
    }
    if (path === "/change") {
      await this.ctx.storage.put("dirty", true);
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null || alarm > Date.now() + 10000) await this.ctx.storage.setAlarm(Date.now() + 10000);
      return new Response(null, { status: 204 });
    }
    if (path !== "/connect" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response(null, { status: 404 });
    if (this.env.REALTIME_ENABLED !== "true" || !this.daily("handshakes", 5000)) return new Response(null, { status: 503 });
    const ip = request.headers.get("x-live-ip") || "unknown";
    const sockets = this.sockets();
    if (sockets.length >= 100 || sockets.filter((ws) => (ws.deserializeAttachment() as Attachment).ip === ip).length >= 5) return new Response(null, { status: 429 });
    const pair = new WebSocketPair();
    const attachment: Attachment = {
      ip,
      username: request.headers.get("x-live-user"),
      sessionId: request.headers.get("x-live-session"),
      expires: Date.now() + 60000,
      users: [],
      lastMessage: 0,
    };
    pair[1].serializeAttachment(attachment);
    this.ctx.acceptWebSocket(pair[1]);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 30000);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 4096) {
      ws.close(1009, "Invalid message");
      return;
    }
    const a = ws.deserializeAttachment() as Attachment;
    if (Date.now() - a.lastMessage < 1000) {
      ws.close(1008, "Message rate exceeded");
      return;
    }
    a.lastMessage = Date.now();
    if (a.sessionId) {
      const session = await this.env.DB.prepare("SELECT u.username FROM session s JOIN user u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>? AND u.suspended=0")
        .bind(a.sessionId, Date.now())
        .first<{ username: string }>();
      if (!session) {
        ws.close(1008, "Session ended");
        return;
      }
      a.username = session.username;
    }
    try {
      const value = JSON.parse(message);
      if (
        value.type !== "heartbeat" ||
        !Array.isArray(value.users) ||
        value.users.length > 100 ||
        value.users.some((name: unknown) => typeof name !== "string" || !/^[a-z_][a-z0-9_]{0,29}$/i.test(name))
      )
        throw new Error();
      a.users = [...new Set(value.users as string[])];
      a.expires = Date.now() + 60000;
      ws.serializeAttachment(a);
      this.presence(ws, a);
    } catch {
      ws.close(1008, "Invalid message");
    }
  }
  async alarm() {
    const dirty = await this.ctx.storage.get<boolean>("dirty");
    await this.ctx.storage.delete("dirty");
    this.ctx.storage.sql.exec("DELETE FROM counters WHERE reset_at<?", Date.now());
    for (const ws of this.sockets()) {
      const a = ws.deserializeAttachment() as Attachment;
      if (a.expires <= Date.now()) {
        ws.close(1000, "Inactive");
        continue;
      }
      if (dirty) this.send(ws, { type: "refresh" });
      if (this.env.PRESENCE_ENABLED === "true") this.presence(ws, a);
    }
    if (this.sockets().length) await this.ctx.storage.setAlarm(Date.now() + 30000);
  }
  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code);
    } catch {}
  }
  async webSocketError(ws: WebSocket) {
    try {
      ws.close(1011);
    } catch {}
  }
}
