CREATE TABLE notifications_new (id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL REFERENCES user(id), actor_id TEXT NOT NULL REFERENCES user(id), post_id TEXT NOT NULL REFERENCES posts(id), kind TEXT NOT NULL CHECK(kind IN ('reply','like','mention')), created_at INTEGER NOT NULL, read_at INTEGER, UNIQUE(recipient_id,actor_id,post_id,kind));
INSERT INTO notifications_new SELECT * FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX notifications_recipient ON notifications(recipient_id, created_at DESC);
