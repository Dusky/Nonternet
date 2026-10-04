-- Apps people add to their own desktop (docs/10, docs/15, 2026-10-04).
-- app_catalog: the packages this site has, read from the apps folder at start; admins choose which are offered.
CREATE TABLE app_catalog (
  app_id text PRIMARY KEY,
  version text NOT NULL,
  manifest jsonb NOT NULL,
  offered boolean NOT NULL DEFAULT true,
  present boolean NOT NULL DEFAULT true,   -- false when the package is no longer in the apps folder
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Which apps each person has added. Removing an app deletes this row and keeps the app's data.
CREATE TABLE app_installs (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, app_id)
);

-- What an app keeps for a person: documents in named collections. One generic store, so everything every
-- app keeps is in the person's export and erased with them, without each app having to remember to.
CREATE TABLE app_data (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id text NOT NULL,
  collection text NOT NULL,
  doc_id text NOT NULL,
  data jsonb NOT NULL,
  bytes integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, app_id, collection, doc_id)
);
