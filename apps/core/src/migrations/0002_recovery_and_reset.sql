-- Password reset, TOTP recovery codes and TOTP replay protection.

-- The last 30-second TOTP time step that was accepted for this user. A code from that step or
-- an earlier one is refused, so a code can be used once.
ALTER TABLE users ADD COLUMN totp_last_step bigint;

CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,                          -- sha256 of the emailed token
  user_id text NOT NULL REFERENCES users (id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user ON password_resets (user_id);

-- Single-use codes for an admin or user who has lost their authenticator. Only hashes are stored.
CREATE TABLE recovery_codes (
  code_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recovery_codes_user ON recovery_codes (user_id);
