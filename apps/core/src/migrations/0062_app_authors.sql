-- Apps made by trusted people (docs/10, 15, 17 2026-10-18; closes Q18). A submitted app's package is stored per version
-- under the files folder; nothing is offered until an admin approves a version, and each new version is reviewed again
-- while the approved one stays live.
ALTER TABLE app_catalog ADD COLUMN source text NOT NULL DEFAULT 'site' CHECK (source IN ('site', 'submitted'));
ALTER TABLE app_catalog ADD COLUMN author_id text REFERENCES users(id);
CREATE INDEX app_catalog_author ON app_catalog (author_id) WHERE author_id IS NOT NULL;

CREATE TABLE app_versions (
  app_id text NOT NULL REFERENCES app_catalog(app_id) ON DELETE CASCADE,
  version text NOT NULL,
  manifest jsonb NOT NULL,
  files jsonb NOT NULL,                   -- [{ path, size }]
  bytes integer NOT NULL,
  -- pending: waiting for review · approved: the live version · declined · replaced: a newer one was approved or sent
  -- before this was reviewed · withdrawn: still waiting when its author took the app back, or deleted their account
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'replaced', 'withdrawn')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  reason text,
  PRIMARY KEY (app_id, version)
);
CREATE INDEX app_versions_pending ON app_versions (submitted_at) WHERE status = 'pending';

ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('post', 'homepage', 'guestbook', 'mail_message', 'file', 'wiki_page', 'bookmark', 'memo', 'app'));
