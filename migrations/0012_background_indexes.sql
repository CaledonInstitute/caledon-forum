ALTER TABLE push_outbox ADD COLUMN expanded INTEGER NOT NULL DEFAULT 0;
CREATE INDEX push_outbox_pending ON push_outbox(expanded,expires_at,created_at);
CREATE INDEX push_outbox_expiry ON push_outbox(expires_at);
CREATE INDEX push_deliveries_pending ON push_deliveries(state,queued_at);
CREATE INDEX rate_limits_expiry ON rate_limits(reset_at);
