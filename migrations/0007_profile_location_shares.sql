ALTER TABLE user ADD COLUMN location TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN shares INTEGER NOT NULL DEFAULT 0 CHECK (shares >= 0);
CREATE INDEX likes_user_created ON likes(user_id,created_at DESC,post_id);
