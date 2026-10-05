-- Push notifications (docs/10, decided 2026-10-05): each browser or phone a person turned push on for. The endpoint is
-- the address the browser's push service gave it; p256dh and auth are the keys messages are encrypted with.
CREATE TABLE push_subscriptions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The session that turned it on. Pushes stop when that session ends (logging out, a password reset, a suspension),
  -- so a shared computer stops getting someone's notifications when they log out.
  session_id text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  kinds text[] NOT NULL DEFAULT '{}',        -- which kinds this device is told about (PUSH_KINDS)
  label text NOT NULL DEFAULT '',            -- "Firefox on Linux", from the browser, so people can tell them apart
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  failures integer NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);
