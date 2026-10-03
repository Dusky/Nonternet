-- Things people can now do for themselves (docs/02): change their email or handle, and sign up by application.

-- A change of email waits here until the new address is confirmed; the old address stays in use until then.
CREATE TABLE email_changes (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  new_email text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_changes_user ON email_changes (user_id, created_at DESC);

-- Renames a person made themselves count toward their once-every-90-days limit; an admin's don't.
ALTER TABLE handle_history ADD COLUMN by_user boolean NOT NULL DEFAULT false;

-- Sign-up by application: what the person wrote, and what the admins decided.
CREATE TABLE applications (
  user_id text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  text text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'declined')),
  decided_by text REFERENCES users (id),
  decided_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX applications_pending ON applications (created_at) WHERE state = 'pending';
