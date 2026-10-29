-- Add stable, non-reused public integer IDs without rewriting existing relations.
CREATE TABLE post_addresses (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id TEXT NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE);
INSERT INTO post_addresses(post_id) SELECT id FROM posts ORDER BY created_at,id;
CREATE TRIGGER posts_assign_address AFTER INSERT ON posts BEGIN INSERT INTO post_addresses(post_id) VALUES(NEW.id); END;
