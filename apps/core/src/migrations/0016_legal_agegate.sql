-- Age confirmation at signup (docs/02): what the person ticked and the minimum in force at the time.
ALTER TABLE users ADD COLUMN age_confirmed_at timestamptz;
ALTER TABLE users ADD COLUMN age_confirmed_min integer;

-- Legal pages (docs/15): admins edit them; every edit is a version. No row means the built-in placeholder text.
CREATE TABLE legal_pages (
  slug text PRIMARY KEY CHECK (slug IN ('terms', 'privacy', 'acceptable-use', 'takedown')),
  title text NOT NULL,
  body text NOT NULL,
  version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES users (id)
);
CREATE TABLE legal_page_versions (
  slug text NOT NULL,
  version integer NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  reason text NOT NULL,
  changed_by text REFERENCES users (id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slug, version)
);

-- Takedown and legal requests from anyone, signed in or not (docs/15). Admins work them from the console.
CREATE TABLE legal_requests (
  id text PRIMARY KEY,                                  -- lr_…
  kind text NOT NULL CHECK (kind IN ('copyright', 'illegal', 'privacy', 'other')),
  url text NOT NULL,
  description text NOT NULL,
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  good_faith boolean NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by text REFERENCES users (id),
  resolved_at timestamptz,
  resolution_note text
);
CREATE INDEX legal_requests_status ON legal_requests (status, created_at);
