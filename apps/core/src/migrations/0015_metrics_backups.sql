-- Numbers for the status board (docs/11), and the record of backups and restore tests (docs/15).
CREATE TABLE metrics_rollup (
  metric text NOT NULL,
  bucket timestamptz NOT NULL,                          -- the start of the hour
  value double precision NOT NULL,
  PRIMARY KEY (metric, bucket)
);

CREATE TABLE backup_runs (
  id text PRIMARY KEY,                                  -- bk_…
  kind text NOT NULL CHECK (kind IN ('backup', 'restore_test')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  size_bytes bigint,
  location text,                                        -- the manifest's file name
  detail jsonb,                                         -- what was counted or checked
  error text
);
CREATE INDEX backup_runs_recent ON backup_runs (kind, started_at DESC);
