CREATE TABLE push_allocations (
 notification_id TEXT PRIMARY KEY REFERENCES push_outbox(notification_id) ON DELETE CASCADE,
 user_id TEXT NOT NULL, day TEXT NOT NULL
);
CREATE TRIGGER push_allocation_count AFTER INSERT ON push_allocations BEGIN
 INSERT INTO push_daily(user_id,day,count) VALUES(NEW.user_id,NEW.day,1)
 ON CONFLICT(user_id,day) DO UPDATE SET count=count+1;
END;
