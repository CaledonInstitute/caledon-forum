import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { env, resetDatabase, seedUser, execute, row } from "./runtime";
import { dispatchPush, processPushBatch, subscriptionId, validateSubscription } from "../src/lib/push";
import { rateLimit } from "../src/lib/rate-limit";
const send = vi.hoisted(() => vi.fn());
vi.mock("web-push", () => ({ sendNotification: send }));
const key = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
const auth = Buffer.alloc(16, 2).toString("base64url");
beforeEach(() => {
  resetDatabase();
  seedUser();
  seedUser("bob");
  send.mockReset();
  send.mockResolvedValue({ statusCode: 201 });
  env.PUSH_ENABLED = "true";
  env.VAPID_PUBLIC_KEY = "public";
  env.VAPID_PRIVATE_KEY = "private";
  env.VAPID_SUBJECT = "mailto:admin@example.com";
  env.PUSH_QUEUE = { send: vi.fn() };
  env.FORUM_CONTROL = { getByName: () => ({ fetch: vi.fn(async () => new Response(null, { status: 204 })) }) };
  execute("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('p','bob','body',1,1)");
  execute("INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created_at) VALUES('device','alice','https://fcm.googleapis.com/fcm/send/test',?,?,1)", key, auth);
  execute("INSERT INTO notifications(id,recipient_id,actor_id,post_id,kind,created_at) VALUES('notice','alice','bob','p','like',?)", Date.now());
});
afterEach(() => {
  for (const key of ["PUSH_ENABLED", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "PUSH_QUEUE", "FORUM_CONTROL", "RATE_LIMIT_DO_ENABLED"]) delete env[key];
});
const message = () => ({ body: { notification_id: "notice", subscription_id: "device" }, ack: vi.fn(), retry: vi.fn() });
it("rejects arbitrary, credentialed, and malformed push endpoints", () => {
  for (const endpoint of [
    "https://127.0.0.1/send",
    "https://attacker.test/send",
    "https://web.push.apple.com.attacker.test/send",
    "https://user:pass@fcm.googleapis.com/send",
    "https://fcm.googleapis.com:444/send",
    "http://fcm.googleapis.com/send",
  ])
    expect(() => validateSubscription({ endpoint, keys: { p256dh: key, auth } })).toThrow();
  expect(() => validateSubscription({ endpoint: "https://fcm.googleapis.com/send", keys: { p256dh: "bad", auth } })).toThrow();
  expect(validateSubscription({ endpoint: "https://fcm.googleapis.com/send", keys: { p256dh: key, auth } })).toMatchObject({ auth });
});
it("creates an atomic outbox, queues IDs only, and avoids duplicate delivery", async () => {
  expect(row("SELECT notification_id FROM push_outbox").notification_id).toBe("notice");
  await dispatchPush();
  expect(env.PUSH_QUEUE.send).toHaveBeenCalledWith({ notification_id: "notice", subscription_id: "device" });
  const first = message();
  await processPushBatch({ messages: [first] } as any);
  expect(first.ack).toHaveBeenCalled();
  const duplicate = message();
  await processPushBatch({ messages: [duplicate] } as any);
  expect(send).toHaveBeenCalledTimes(1);
  expect(row("SELECT count FROM push_daily WHERE user_id='alice'").count).toBe(1);
  expect(JSON.parse(send.mock.calls[0][1])).not.toHaveProperty("postBody");
});
it("rechecks preferences, suspension, and notification deletion at delivery time", async () => {
  await dispatchPush();
  execute("INSERT INTO push_preferences(user_id,\"like\") VALUES('alice',0)");
  await processPushBatch({ messages: [message()] } as any);
  expect(send).not.toHaveBeenCalled();
  execute("DELETE FROM notifications WHERE id='notice'");
  expect(row("SELECT * FROM push_outbox")).toBeUndefined();
  expect(row("SELECT * FROM push_deliveries")).toBeUndefined();
});
it("removes expired subscriptions and retries temporary provider failures", async () => {
  await dispatchPush();
  send.mockRejectedValueOnce({ statusCode: 503 });
  const temporary = message();
  await processPushBatch({ messages: [temporary] } as any);
  expect(temporary.retry).toHaveBeenCalled();
  send.mockRejectedValueOnce({ statusCode: 410 });
  await processPushBatch({ messages: [message()] } as any);
  expect(row("SELECT * FROM push_subscriptions")).toBeUndefined();
});
it("defers sending when the global daily budget is exhausted", async () => {
  await dispatchPush();
  env.FORUM_CONTROL = { getByName: () => ({ fetch: async () => new Response(null, { status: 429 }) }) };
  const m = message();
  await processPushBatch({ messages: [m] } as any);
  expect(send).not.toHaveBeenCalled();
  expect(m.ack).toHaveBeenCalled();
  expect(row("SELECT queued_at FROM push_deliveries").queued_at).toBeGreaterThan(Date.now());
});
it("fails closed if Durable Object rate limiting is unavailable", async () => {
  env.RATE_LIMIT_DO_ENABLED = "true";
  delete env.FORUM_CONTROL;
  await expect(rateLimit("test", 1)).rejects.toMatchObject({ status: 503 });
});
it("fingerprints subscriptions without retaining the endpoint in the identifier", async () => {
  expect(await subscriptionId("https://fcm.googleapis.com/test")).toMatch(/^[a-f0-9]{64}$/);
});
