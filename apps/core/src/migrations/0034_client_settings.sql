-- Settings for the chat and MUD clients (docs/08, docs/18, 2026-10-02): ignore lists, highlights, aliases,
-- triggers, timers, keys, buttons. Kept on the account so they follow the person, exported, erased with them.
CREATE TABLE client_settings (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client text NOT NULL CHECK (client IN ('chat', 'mud')),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client)
);
