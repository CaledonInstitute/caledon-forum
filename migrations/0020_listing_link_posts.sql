-- Convert previous automatic listing posts to ordinary link posts. Preserve
-- addresses, authors, timestamps, replies and reactions.
UPDATE posts SET body='[/marketplace/'||listing_id||'](/marketplace/'||listing_id||')',editor_doc=NULL,original_body=NULL
WHERE listing_id IS NOT NULL AND deleted=0;
DROP INDEX posts_listing;
ALTER TABLE posts DROP COLUMN listing_id;
