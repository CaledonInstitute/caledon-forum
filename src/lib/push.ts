import { env } from "cloudflare:workers";
import { all, db, one, run } from "./db";
import { reserveBudget } from "./control";
export function pushReady() {
  return env.PUSH_ENABLED === "true" && !!(env.PUSH_QUEUE && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}
export async function subscriptionId(endpoint: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint))), (n) => n.toString(16).padStart(2, "0")).join("");
}
export function validateSubscription(value: any) {
  const url = new URL(String(value?.endpoint));
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.href.length > 2048 ||
    (!["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(host) && !host.endsWith(".notify.windows.com"))
  )
    throw new Error("Unsupported push service.");
  const p256dh = String(value.keys?.p256dh || ""),
    auth = String(value.keys?.auth || "");
  if (!/^[A-Za-z0-9_-]{87}={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}={0,2}$/.test(auth)) throw new Error("Invalid subscription keys.");
  const decode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  if (decode(p256dh).length !== 65 || decode(p256dh)[0] !== 4 || decode(auth).length !== 16) throw new Error("Invalid subscription keys.");
  return { endpoint: url.href, p256dh, auth };
}
export async function dispatchPush() {
  if (!pushReady()) return;
  const fresh = await all<{ notification_id: string }>("SELECT notification_id FROM push_outbox WHERE expanded=0 AND expires_at>? ORDER BY created_at LIMIT 50", Date.now());
  if (fresh.length) {
    const ids = JSON.stringify(fresh.map((item) => item.notification_id));
    await db().batch([
      db()
        .prepare(
          `INSERT OR IGNORE INTO push_deliveries(notification_id,subscription_id)
    SELECT o.notification_id,s.id FROM push_outbox o JOIN notifications n ON n.id=o.notification_id
    JOIN push_subscriptions s ON s.user_id=n.recipient_id LEFT JOIN push_preferences p ON p.user_id=n.recipient_id
    WHERE o.notification_id IN (SELECT value FROM json_each(?)) AND o.expires_at>? AND o.created_at>=s.created_at AND n.read_at IS NULL AND CASE n.kind WHEN 'reply' THEN COALESCE(p.reply,1) WHEN 'mention' THEN COALESCE(p.mention,1) ELSE COALESCE(p."like",1) END=1`
        )
        .bind(ids, Date.now()),
      db().prepare("UPDATE push_outbox SET expanded=1 WHERE notification_id IN (SELECT value FROM json_each(?))").bind(ids),
    ]);
  }
  const pending = await all<{ notification_id: string; subscription_id: string }>(
    `SELECT d.notification_id,d.subscription_id FROM push_deliveries d JOIN push_outbox o ON o.notification_id=d.notification_id WHERE d.state='pending' AND o.expires_at>? AND (d.queued_at IS NULL OR d.queued_at<?) LIMIT 50`,
    Date.now(),
    Date.now() - 300000
  );
  for (const item of pending) {
    if (!(await reserveBudget("queue-messages", 1000))) {
      const tomorrow = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) + 86400000;
      await run("UPDATE push_deliveries SET queued_at=? WHERE state='pending' AND (queued_at IS NULL OR queued_at<?)", tomorrow, Date.now() - 300000);
      break;
    }
    await env.PUSH_QUEUE!.send(item);
    await run("UPDATE push_deliveries SET queued_at=? WHERE notification_id=? AND subscription_id=? AND state='pending'", Date.now(), item.notification_id, item.subscription_id);
  }
}
export async function consumePush(batch: MessageBatch) {
  for (const message of batch.messages) {
    try {
      if (!env.FORUM_CONTROL) throw new Error("Push sender unavailable");
      const response = await env.FORUM_CONTROL.getByName(`push-sender-${String((message.body as any)?.subscription_id || "0").slice(0, 1)}`).fetch(
        "https://control/push-delivery",
        { method: "POST", body: JSON.stringify(message.body) }
      );
      if (response.ok) message.ack();
      else message.retry({ delaySeconds: 60 });
    } catch {
      message.retry({ delaySeconds: 60 });
    }
  }
}
export async function processPushBatch(batch: MessageBatch) {
  for (const message of batch.messages) {
    const item = message.body as any;
    if (typeof item?.notification_id !== "string" || typeof item?.subscription_id !== "string") {
      message.ack();
      continue;
    }
    const args = [item.notification_id, item.subscription_id];
    if (!pushReady()) {
      await run("UPDATE push_deliveries SET queued_at=NULL WHERE notification_id=? AND subscription_id=?", ...args);
      message.ack();
      continue;
    }
    const delivery = await one<any>(
      `SELECT d.state,d.attempts,o.expires_at,n.kind,n.recipient_id,n.read_at,s.endpoint,s.p256dh,s.auth,pa.id AS public_id,u.suspended,p.deleted,
      CASE n.kind WHEN 'reply' THEN COALESCE(pref.reply,1) WHEN 'mention' THEN COALESCE(pref.mention,1) ELSE COALESCE(pref."like",1) END AS enabled
      FROM push_deliveries d JOIN push_outbox o ON o.notification_id=d.notification_id JOIN notifications n ON n.id=o.notification_id
      JOIN push_subscriptions s ON s.id=d.subscription_id AND s.user_id=n.recipient_id JOIN user u ON u.id=n.recipient_id
      JOIN posts p ON p.id=n.post_id JOIN post_addresses pa ON pa.post_id=p.id LEFT JOIN push_preferences pref ON pref.user_id=u.id
      WHERE d.notification_id=? AND d.subscription_id=?`,
      ...args
    );
    if (!delivery || delivery.state !== "pending") {
      message.ack();
      continue;
    }
    if (delivery.expires_at <= Date.now() || delivery.suspended || delivery.deleted || delivery.read_at || !delivery.enabled || delivery.attempts >= 3) {
      await run("UPDATE push_deliveries SET state='skipped' WHERE notification_id=? AND subscription_id=?", ...args);
      message.ack();
      continue;
    }
    try {
      validateSubscription({ endpoint: delivery.endpoint, keys: delivery });
      const day = new Date().toISOString().slice(0, 10);
      const allowed = await reserveBudget("push-attempts", 1000);
      if (allowed)
        await run(
          "INSERT OR IGNORE INTO push_allocations(notification_id,user_id,day) SELECT ?,?,? WHERE COALESCE((SELECT count FROM push_daily WHERE user_id=? AND day=?),0)<100",
          item.notification_id,
          delivery.recipient_id,
          day,
          delivery.recipient_id,
          day
        );
      const perUser = allowed ? await one("SELECT notification_id FROM push_allocations WHERE notification_id=?", item.notification_id) : null;
      if (!allowed || !perUser) {
        await run("UPDATE push_deliveries SET queued_at=? WHERE notification_id=? AND subscription_id=?", Date.parse(`${day}T00:00:00Z`) + 86400000, ...args);
        message.ack();
        continue;
      }
      const claimed = await db()
        .prepare("UPDATE push_deliveries SET state='sending',attempts=attempts+1 WHERE notification_id=? AND subscription_id=? AND state='pending'")
        .bind(...args)
        .run();
      if (!claimed.meta.changes) {
        message.ack();
        continue;
      }
      const webpush = await import("web-push");
      await webpush.sendNotification(
        { endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } },
        JSON.stringify({
          title: "Caledon Forum",
          body: delivery.kind === "like" ? "Someone liked your post." : delivery.kind === "mention" ? "Someone mentioned you." : "You have a new reply.",
          url: `/p/${delivery.public_id}`,
          tag: `caledon-${item.notification_id}`,
        }),
        {
          vapidDetails: { subject: env.VAPID_SUBJECT!, publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! },
          TTL: Math.max(1, Math.min(86400, Math.floor((delivery.expires_at - Date.now()) / 1000))),
          timeout: 8000,
          urgency: "normal",
        }
      );
      await run("UPDATE push_deliveries SET state='sent' WHERE notification_id=? AND subscription_id=?", ...args);
      message.ack();
    } catch (error: any) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await run("DELETE FROM push_subscriptions WHERE id=?", item.subscription_id);
        message.ack();
      } else if (!error.statusCode || error.statusCode === 429 || error.statusCode >= 500) {
        await run("UPDATE push_deliveries SET state='pending' WHERE notification_id=? AND subscription_id=?", ...args);
        message.retry({ delaySeconds: 60 });
      } else {
        await run("UPDATE push_deliveries SET state='failed' WHERE notification_id=? AND subscription_id=?", ...args);
        message.ack();
      }
    }
  }
}
