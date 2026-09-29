-- Scoped ops, the event outbox, and an append-only audit log.

-- Ops (docs/03): moderators scoped to one board, ring or channel. scope_id has no foreign key yet
-- because boards and rings arrive in M2 and M3; the API checks the ID format until then.
CREATE TABLE scoped_roles (
  id text PRIMARY KEY,                                  -- o_…
  user_id text NOT NULL REFERENCES users (id),
  role text NOT NULL CHECK (role IN ('board_op', 'ring_op', 'channel_op', 'mud_builder')),
  scope_type text NOT NULL CHECK (scope_type IN ('board', 'ring', 'channel', 'mud')),
  scope_id text NOT NULL,
  granted_by text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, scope_type, scope_id)
);
CREATE INDEX scoped_roles_scope ON scoped_roles (scope_type, scope_id);

-- Transactional outbox (docs/14). A domain event is inserted in the same transaction as the change
-- that caused it, so a crash can never commit the change and lose the event. A relay publishes
-- unpublished rows to the Redis stream. Delivery is at-least-once; consumers must be idempotent.
CREATE TABLE events_outbox (
  id bigserial PRIMARY KEY,
  event_id text NOT NULL UNIQUE,                        -- e_… ULID, also the consumer's idempotency key
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX events_outbox_unpublished ON events_outbox (id) WHERE published_at IS NULL;

-- The audit log is append-only (docs/03, docs/15). These triggers refuse UPDATE, DELETE and
-- TRUNCATE for every role, including the table owner. Production should also run the app as a
-- role that has INSERT and SELECT only (docs/15); the triggers are the second lock.
CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
