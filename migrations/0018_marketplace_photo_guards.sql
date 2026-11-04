-- These checks are inside the write transaction, including concurrent publishers.
CREATE TRIGGER IF NOT EXISTS marketplace_photo_guard BEFORE INSERT ON marketplace_photos BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM post_attachments WHERE asset_id=NEW.asset_id)
 OR NOT EXISTS(SELECT 1 FROM marketplace_listings l JOIN user u ON u.id=l.seller_id JOIN uploads a ON a.owner_id=u.id
 WHERE l.id=NEW.listing_id AND l.deleted=0 AND u.suspended=0 AND u.deleting_at IS NULL
 AND a.id=NEW.asset_id AND a.state='ready' AND a.purpose='post' AND a.mime LIKE 'image/%')
 THEN RAISE(ABORT,'marketplace photo unavailable') END;
END;
CREATE TRIGGER IF NOT EXISTS post_marketplace_photo_guard BEFORE INSERT ON post_attachments BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM marketplace_photos WHERE asset_id=NEW.asset_id)
 THEN RAISE(ABORT,'photo already belongs to marketplace') END;
END;
