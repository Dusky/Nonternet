-- The wiki (docs/20, decided 2026-10-05): one for the site, and one each ring can switch on.
CREATE TABLE wikis (
  id text PRIMARY KEY,
  scope_type text NOT NULL CHECK (scope_type IN ('site', 'ring')),
  ring_id text REFERENCES rings(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope_type = 'site') = (ring_id IS NULL))
);
CREATE UNIQUE INDEX wikis_one_site ON wikis ((true)) WHERE scope_type = 'site';
CREATE UNIQUE INDEX wikis_one_per_ring ON wikis (ring_id) WHERE ring_id IS NOT NULL;
INSERT INTO wikis (id, scope_type) VALUES ('wk_site', 'site');

-- A page holds its current text; every version, the first included, is a row in wiki_revisions.
CREATE TABLE wiki_pages (
  id text PRIMARY KEY,
  wiki_id text NOT NULL REFERENCES wikis(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  body_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || body)) STORED,
  revision integer NOT NULL DEFAULT 1,
  protected boolean NOT NULL DEFAULT false,
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  hidden_at timestamptz,                 -- hidden by an admin or op, with a reason in the audit log
  deleted_at timestamptz                 -- deleted (restorable) by an admin or op
);
CREATE UNIQUE INDEX wiki_pages_slug ON wiki_pages (wiki_id, slug);
CREATE INDEX wiki_pages_tsv ON wiki_pages USING gin (body_tsv);
CREATE INDEX wiki_pages_updated ON wiki_pages (wiki_id, updated_at DESC);

CREATE TABLE wiki_revisions (
  id text PRIMARY KEY,
  page_id text NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  editor_id text REFERENCES users(id),   -- null once their account is deleted
  title text NOT NULL,
  body text NOT NULL,
  summary text NOT NULL DEFAULT '',
  reverted_to integer,                   -- set when this revision restored an older one
  text_hidden_at timestamptz,            -- the text is kept from view (doxxing, illegal content)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, revision)
);
CREATE INDEX wiki_revisions_editor ON wiki_revisions (editor_id, created_at DESC);
CREATE INDEX wiki_revisions_recent ON wiki_revisions (created_at DESC);

-- A renamed page keeps answering at its old addresses.
CREATE TABLE wiki_redirects (
  wiki_id text NOT NULL REFERENCES wikis(id) ON DELETE CASCADE,
  slug text NOT NULL,
  page_id text NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  PRIMARY KEY (wiki_id, slug)
);

-- Which pages each page links to, rebuilt on every save: "what links here", and pages people want written.
CREATE TABLE wiki_links (
  page_id text NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  target_slug text NOT NULL,
  target_title text NOT NULL,
  PRIMARY KEY (page_id, target_slug)
);
CREATE INDEX wiki_links_target ON wiki_links (target_slug);

ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('post', 'homepage', 'guestbook', 'mail_message', 'file', 'wiki_page'));
