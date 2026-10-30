import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

it("preserves pending deliveries, allocations, counters and expiry during the DM migration without backfilling history", () => {
  const database = new DatabaseSync(":memory:");
  try {
    const migrations = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql") && name < "0014")
      .sort())
      database.exec(readFileSync(new URL(file, migrations), "utf8"));
    database.exec(`
      INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES('a','A','a@example.com',1,1,1),('b','B','b@example.com',1,1,1);
      INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('p','b','body',1,1);
      INSERT INTO notifications(id,recipient_id,actor_id,post_id,kind,created_at) VALUES('n','a','b','p','like',123);
      INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created_at) VALUES('s','a','https://fcm.googleapis.com/test','key','auth',1);
      UPDATE push_outbox SET expanded=1;
      INSERT INTO push_deliveries VALUES('n','s','pending',456,2);
      INSERT INTO push_allocations VALUES('n','a','2026-10-30');
      INSERT INTO dm_conversations VALUES('c','a','b',1,1);
      INSERT INTO dm_messages(id,conversation_id,sender_id,sender_version,recipient_version,sender_public_key,envelopes,created_at) VALUES('old','c','b',1,1,'key','cipher',1);
    `);
    database.exec(readFileSync(new URL("0014_dm_push.sql", migrations), "utf8"));
    expect(database.prepare("SELECT * FROM push_deliveries").get()).toMatchObject({ notification_id: "n", subscription_id: "s", state: "pending", queued_at: 456, attempts: 2 });
    expect(database.prepare("SELECT * FROM push_outbox").get()).toMatchObject({
      notification_id: "n",
      forum_notification_id: "n",
      dm_message_id: null,
      created_at: 123,
      expires_at: 86400123,
      expanded: 1,
    });
    expect(database.prepare("SELECT count FROM push_daily").get()).toMatchObject({ count: 1 });
    expect(database.prepare("SELECT * FROM push_allocations").get()).toMatchObject({ notification_id: "n", user_id: "a", day: "2026-10-30" });
    expect(database.prepare("SELECT * FROM push_outbox WHERE dm_message_id IS NOT NULL").get()).toBeUndefined();
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    database.exec("DELETE FROM notifications WHERE id='n'");
    expect(database.prepare("SELECT * FROM push_deliveries").get()).toBeUndefined();
    expect(database.prepare("SELECT * FROM push_allocations").get()).toBeUndefined();
  } finally {
    database.close();
  }
});
