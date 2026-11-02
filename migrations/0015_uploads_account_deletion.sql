ALTER TABLE user ADD COLUMN deleting_at INTEGER;
CREATE TABLE uploads (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES user(id), purpose TEXT NOT NULL CHECK(purpose IN ('avatar','cover','post','dm')),
 conversation_id TEXT REFERENCES dm_conversations(id), name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
 object_key TEXT NOT NULL UNIQUE, upload_id TEXT, object_version TEXT, state TEXT NOT NULL DEFAULT 'pending', lock_until INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX uploads_owner ON uploads(owner_id,state);
CREATE INDEX uploads_cleanup ON uploads(state,expires_at);
CREATE TABLE upload_parts (
 asset_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE, part INTEGER NOT NULL, etag TEXT NOT NULL, size INTEGER NOT NULL,
 PRIMARY KEY(asset_id,part)
);
CREATE TABLE post_attachments (
 post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, asset_id TEXT NOT NULL UNIQUE REFERENCES uploads(id), position INTEGER NOT NULL,
 PRIMARY KEY(post_id,asset_id)
);
CREATE TABLE dm_attachments (
 message_id TEXT NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE, asset_id TEXT NOT NULL UNIQUE REFERENCES uploads(id),
 PRIMARY KEY(message_id,asset_id)
);
CREATE TABLE account_deletions (user_id TEXT PRIMARY KEY REFERENCES user(id), created_at INTEGER NOT NULL);
CREATE TABLE deletion_intents (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, session_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);

CREATE TRIGGER protect_last_admin BEFORE UPDATE OF deleting_at ON user
WHEN OLD.role='admin' AND OLD.deleting_at IS NULL AND NEW.deleting_at IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM user WHERE role='admin' AND id<>OLD.id AND deleting_at IS NULL AND suspended=0)
BEGIN SELECT RAISE(ABORT,'Cannot delete the last active administrator'); END;
