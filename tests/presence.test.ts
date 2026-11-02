import { beforeEach, expect, it, vi } from "vitest";
import { env, resetDatabase, seedUser, execute } from "./runtime";

vi.mock("cloudflare:workers", async (original) => ({
  ...(await original<object>()),
  DurableObject: class {
    constructor(
      public ctx: any,
      public env: any
    ) {}
  },
}));
import { ForumControl } from "../src/worker/control";

class Socket {
  readyState: number = WebSocket.OPEN;
  sent: any[] = [];
  data: any;
  constructor(sessionId: string | null, username: string | null) {
    this.data = { sessionId, username, ip: "local", users: ["alice"], lastMessage: 0, expires: 1 };
  }
  deserializeAttachment() {
    return this.data;
  }
  serializeAttachment(value: any) {
    this.data = value;
  }
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    this.readyState = WebSocket.CLOSED;
  }
}
let sockets: Socket[], controller: ForumControl;
beforeEach(() => {
  resetDatabase();
  seedUser();
  execute("UPDATE user SET show_activity=1 WHERE id='alice'");
  for (const id of ["one", "two"]) execute("INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,'alice',?,1,1)", id, id, Date.now() + 3600000);
  sockets = [new Socket("one", "alice"), new Socket("two", "alice"), new Socket(null, null)];
  const state = {
    getWebSockets: () => sockets.filter((s) => s.readyState === WebSocket.OPEN),
    storage: { get: async () => false, delete: async () => {}, setAlarm: async () => {}, sql: { exec: () => ({ one: () => ({ count: 1 }) }) } },
  };
  controller = new ForumControl(state as any, { ...env, PRESENCE_ENABLED: "true" } as any);
});
it("keeps authenticated open sockets online through delayed heartbeats and alarms", async () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 90000);
  await controller.alarm();
  clock.mockRestore();
  expect(sockets.every((s) => s.readyState === WebSocket.OPEN)).toBe(true);
  expect(sockets[2].sent.at(-1).users.alice.online).toBe(true);
});
it("keeps presence until the last tab or device closes and broadcasts the change", async () => {
  await controller.webSocketClose(sockets[0] as any, 1000);
  expect(sockets[2].sent.at(-1).users.alice.online).toBe(true);
  await controller.webSocketClose(sockets[1] as any, 1000);
  expect(sockets[2].sent.at(-1).users.alice.online).toBe(false);
});
it("closes invalid sessions on alarm and never reports them as online", async () => {
  execute("DELETE FROM session");
  await controller.alarm();
  expect(sockets[0].readyState).toBe(WebSocket.CLOSED);
  expect(sockets[1].readyState).toBe(WebSocket.CLOSED);
  expect(sockets[2].sent.at(-1).users.alice.online).toBe(false);
});
it("logout closes only its session and preserves another connected device", async () => {
  await controller.fetch(new Request("https://control/session-ended", { method: "POST", body: JSON.stringify({ sessionId: "one" }) }));
  expect(sockets[0].readyState).toBe(WebSocket.CLOSED);
  expect(sockets[1].readyState).toBe(WebSocket.OPEN);
  expect(sockets[2].sent.at(-1).users.alice.online).toBe(true);
});
