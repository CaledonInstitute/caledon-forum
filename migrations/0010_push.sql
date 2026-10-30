CREATE TABLE push_preferences (
 user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
 reply INTEGER NOT NULL DEFAULT 1, mention INTEGER NOT NULL DEFAULT 1, "like" INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE push_subscriptions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
CREATE TABLE push_outbox (
 notification_id TEXT PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE push_deliveries (
 notification_id TEXT NOT NULL REFERENCES push_outbox(notification_id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'pending', queued_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(notification_id,subscription_id)
);
CREATE TABLE push_daily (user_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(user_id,day));
CREATE TRIGGER notifications_push AFTER INSERT ON notifications BEGIN
 INSERT INTO push_outbox(notification_id,created_at,expires_at) VALUES(NEW.id,NEW.created_at,NEW.created_at+86400000);
END;
