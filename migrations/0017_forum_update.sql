-- Preserve the original source and freeze only content present at cutover.
ALTER TABLE posts ADD COLUMN editor_doc TEXT;
ALTER TABLE posts ADD COLUMN original_body TEXT;
ALTER TABLE posts ADD COLUMN legacy_readonly INTEGER NOT NULL DEFAULT 0;
UPDATE posts SET original_body=body,legacy_readonly=1;
CREATE TABLE announcement (slot INTEGER PRIMARY KEY CHECK(slot=1),post_id TEXT NOT NULL REFERENCES posts(id));
CREATE TRIGGER unpin_deleted_post AFTER UPDATE OF deleted ON posts WHEN NEW.deleted=1 BEGIN
  DELETE FROM announcement WHERE post_id=NEW.id;
END;
CREATE TABLE marketplace_listings (
 id TEXT PRIMARY KEY,seller_id TEXT NOT NULL REFERENCES user(id),kind TEXT NOT NULL CHECK(kind IN ('goods','service')),
 title TEXT NOT NULL,description TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>=0),negotiable INTEGER NOT NULL DEFAULT 0,
 location TEXT NOT NULL DEFAULT '',condition TEXT CHECK(condition IN ('new','used')),status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
 deleted INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
);
CREATE INDEX marketplace_recent ON marketplace_listings(deleted,status,created_at DESC,id DESC);
CREATE TABLE marketplace_photos (listing_id TEXT NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,asset_id TEXT NOT NULL UNIQUE REFERENCES uploads(id),position INTEGER NOT NULL,PRIMARY KEY(listing_id,asset_id));
CREATE TABLE marketplace_reports (id TEXT PRIMARY KEY,listing_id TEXT NOT NULL REFERENCES marketplace_listings(id),reporter_id TEXT NOT NULL REFERENCES user(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX marketplace_open_report ON marketplace_reports(listing_id,reporter_id) WHERE status='open';
