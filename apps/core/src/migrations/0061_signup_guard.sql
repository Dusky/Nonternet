-- Sign-up protections (docs/15, 17 2026-10-18): the network a person signed up from, as a keyed hash of its /24 or /48,
-- and the proof-of-work answers already used, so each works once.
ALTER TABLE users ADD COLUMN signup_net text;
CREATE INDEX users_signup_net ON users (signup_net, created_at) WHERE signup_net IS NOT NULL;

CREATE TABLE signup_proofs (
  signature text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX signup_proofs_expires ON signup_proofs (expires_at);
