ALTER TABLE push_preferences ADD COLUMN dm INTEGER NOT NULL DEFAULT 1;

-- Rebuild the outbox and its dependents without losing queued work or allocations.
CREATE TABLE push_deliveries_backup AS SELECT * FROM push_deliveries;
CREATE TABLE push_allocations_backup AS SELECT * FROM push_allocations;
CREATE TABLE push_outbox_backup AS SELECT * FROM push_outbox;
DROP TRIGGER notifications_push;
DROP TABLE push_deliveries;
DROP TABLE push_allocations;
DROP TABLE push_outbox;
CREATE TABLE push_outbox (
 notification_id TEXT PRIMARY KEY,
 forum_notification_id TEXT UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
 dm_message_id TEXT UNIQUE REFERENCES dm_messages(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, expanded INTEGER NOT NULL DEFAULT 0,
 CHECK ((forum_notification_id IS NOT NULL) + (dm_message_id IS NOT NULL) = 1)
);
INSERT INTO push_outbox(notification_id,forum_notification_id,created_at,expires_at,expanded)
 SELECT notification_id,notification_id,created_at,expires_at,expanded FROM push_outbox_backup;
CREATE INDEX push_outbox_pending ON push_outbox(expanded,expires_at,created_at);
CREATE INDEX push_outbox_expiry ON push_outbox(expires_at);
CREATE TABLE push_deliveries (
 notification_id TEXT NOT NULL REFERENCES push_outbox(notification_id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'pending', queued_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(notification_id,subscription_id)
);
INSERT INTO push_deliveries SELECT * FROM push_deliveries_backup;
CREATE TABLE push_allocations (
 notification_id TEXT PRIMARY KEY REFERENCES push_outbox(notification_id) ON DELETE CASCADE,
 user_id TEXT NOT NULL, day TEXT NOT NULL
);
INSERT INTO push_allocations SELECT * FROM push_allocations_backup;
CREATE TRIGGER push_allocation_count AFTER INSERT ON push_allocations BEGIN
 INSERT INTO push_daily(user_id,day,count) VALUES(NEW.user_id,NEW.day,1)
 ON CONFLICT(user_id,day) DO UPDATE SET count=count+1;
END;
CREATE TRIGGER notifications_push AFTER INSERT ON notifications BEGIN
 INSERT INTO push_outbox(notification_id,forum_notification_id,created_at,expires_at)
 VALUES(NEW.id,NEW.id,NEW.created_at,NEW.created_at+86400000);
END;
CREATE TRIGGER dm_messages_push AFTER INSERT ON dm_messages BEGIN
 INSERT INTO push_outbox(notification_id,dm_message_id,created_at,expires_at)
 VALUES('dm:' || NEW.id,NEW.id,NEW.created_at,NEW.created_at+86400000);
END;
DROP TABLE push_deliveries_backup;
DROP TABLE push_allocations_backup;
DROP TABLE push_outbox_backup;

CREATE VIEW push_sources AS
 SELECT o.notification_id,n.kind,n.recipient_id,n.read_at,pa.id AS public_id,
 NULL AS conversation_id,NOT p.deleted AS eligible
 FROM push_outbox o JOIN notifications n ON n.id=o.forum_notification_id
 JOIN posts p ON p.id=n.post_id JOIN post_addresses pa ON pa.post_id=p.id
 UNION ALL
 SELECT o.notification_id,'dm',recipient.id,
 CASE WHEN r.seq>=m.seq THEN 1 ELSE NULL END,NULL,c.id,
 sender.suspended=0 AND sender.email_verified=1 AND sender.username IS NOT NULL
 AND recipient.email_verified=1 AND recipient.username IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM dm_blocks b WHERE
 (b.user_id=m.sender_id AND b.blocked_id=recipient.id) OR
 (b.user_id=recipient.id AND b.blocked_id=m.sender_id))
 FROM push_outbox o JOIN dm_messages m ON m.id=o.dm_message_id
 JOIN dm_conversations c ON c.id=m.conversation_id
 JOIN user sender ON sender.id=m.sender_id
 JOIN user recipient ON recipient.id=CASE WHEN c.user_a=m.sender_id THEN c.user_b ELSE c.user_a END
 LEFT JOIN dm_reads r ON r.conversation_id=c.id AND r.user_id=recipient.id;
