CREATE TABLE IF NOT EXISTS previous_usernames (
 username TEXT PRIMARY KEY COLLATE NOCASE,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS previous_usernames_user ON previous_usernames(user_id);

CREATE VIEW IF NOT EXISTS username_owners AS
 SELECT username,id AS user_id FROM user WHERE username IS NOT NULL
 UNION ALL
 SELECT username,user_id FROM previous_usernames;

CREATE TRIGGER IF NOT EXISTS reserve_previous_username_on_insert BEFORE INSERT ON user
WHEN NEW.username IS NOT NULL AND EXISTS(SELECT 1 FROM previous_usernames WHERE username=NEW.username)
BEGIN
 SELECT RAISE(ABORT,'username already taken');
END;

CREATE TRIGGER IF NOT EXISTS record_username_change AFTER UPDATE OF username ON user
WHEN NEW.username IS NOT NULL AND NEW.username IS NOT OLD.username
BEGIN
 SELECT RAISE(ABORT,'username already taken') WHERE EXISTS(
   SELECT 1 FROM previous_usernames WHERE username=NEW.username AND user_id<>NEW.id
 );
 INSERT INTO previous_usernames(username,user_id) SELECT OLD.username,NEW.id WHERE OLD.username IS NOT NULL;
 DELETE FROM previous_usernames WHERE username=NEW.username AND user_id=NEW.id;
END;
