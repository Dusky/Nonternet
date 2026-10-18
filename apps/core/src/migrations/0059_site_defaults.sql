-- Site-wide defaults admins set from the web (docs/10, 17 2026-10-18). First: the desktop layout people get until they arrange
-- their own (`desktop`): which apps are hidden, where icons sit, the phone order and the home panel's widgets.
CREATE TABLE site_defaults (
  key text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
