-- Support direct-reply lists and counts without scanning the conversation table.
CREATE INDEX IF NOT EXISTS posts_parent ON posts(parent_id, created_at, id);
