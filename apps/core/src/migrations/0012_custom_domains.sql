-- Custom domains for homepages (docs/07): a person points their own domain at their homepage and
-- proves it is theirs with a DNS record. Only verified domains are served or given a certificate.
CREATE TABLE custom_domains (
  id text PRIMARY KEY,                                  -- d_…
  user_id text NOT NULL REFERENCES users (id),
  domain text NOT NULL,                                 -- lowercase, no trailing dot
  verify_token text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified')),
  verified_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, domain)
);
-- Several people may ask for a name, but only the one who proves it with the DNS record gets it.
CREATE UNIQUE INDEX custom_domains_verified ON custom_domains (domain) WHERE status = 'verified';
CREATE INDEX custom_domains_lookup ON custom_domains (domain) WHERE status = 'verified';
