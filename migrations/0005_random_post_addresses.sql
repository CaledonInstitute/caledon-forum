-- Preserve every existing address verbatim; allocate random 19-digit text IDs
-- only for posts inserted after this migration. TEXT avoids JS precision loss.
DROP TRIGGER posts_assign_address;
CREATE TABLE post_addresses_new (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 19 AND id NOT GLOB '*[^0-9]*' AND substr(id,1,1) <> '0'),
  post_id TEXT NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE
);
INSERT INTO post_addresses_new(id,post_id) SELECT CAST(id AS TEXT),post_id FROM post_addresses;
DROP TABLE post_addresses;
ALTER TABLE post_addresses_new RENAME TO post_addresses;
CREATE TRIGGER posts_assign_address AFTER INSERT ON posts BEGIN
  INSERT INTO post_addresses(id,post_id)
  VALUES(CAST(1 + abs(random() % 9) AS TEXT) || printf('%018d',abs(random() % 1000000000000000000)),NEW.id);
END;
