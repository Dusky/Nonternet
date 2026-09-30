-- Vouching (docs/03, Q10 decided 2026-09-30): two trusted people vouch for someone, an admin confirms.
-- Sponsors are flagged if the person is demoted or suspended soon after.
CREATE TABLE vouches (
  id text PRIMARY KEY,                                  -- vo_…
  candidate_id text NOT NULL REFERENCES users (id),
  voucher_id text NOT NULL REFERENCES users (id),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  outcome text CHECK (outcome IN ('confirmed', 'declined')),
  decided_at timestamptz,
  decided_by text REFERENCES users (id),
  CHECK (candidate_id <> voucher_id)
);
-- One open vouch per voucher per person. After a decision or a withdrawal they may vouch again.
CREATE UNIQUE INDEX vouches_one_open ON vouches (candidate_id, voucher_id) WHERE withdrawn_at IS NULL AND outcome IS NULL;
CREATE INDEX vouches_open ON vouches (candidate_id) WHERE withdrawn_at IS NULL AND outcome IS NULL;
CREATE INDEX vouches_by ON vouches (voucher_id);

CREATE TABLE sponsor_flags (
  id text PRIMARY KEY,                                  -- sf_…
  vouch_id text NOT NULL UNIQUE REFERENCES vouches (id),
  voucher_id text NOT NULL REFERENCES users (id),
  candidate_id text NOT NULL REFERENCES users (id),
  reason text NOT NULL CHECK (reason IN ('demoted', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_flags_voucher ON sponsor_flags (voucher_id);
