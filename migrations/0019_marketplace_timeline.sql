-- One ordinary timeline post per newly published listing; listing photos remain
-- owned by the marketplace rather than being duplicated as post attachments.
ALTER TABLE posts ADD COLUMN listing_id TEXT REFERENCES marketplace_listings(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX posts_listing ON posts(listing_id) WHERE listing_id IS NOT NULL;
