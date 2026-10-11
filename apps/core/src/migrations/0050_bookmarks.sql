-- Bookmarks (docs/21). The site keeps the address, title, description and a small icon, never a copy of the page.
CREATE TABLE bookmarks (
  id text PRIMARY KEY,                                   -- bm_…
  user_id text NOT NULL REFERENCES users (id),
  url text NOT NULL,                                     -- as the person gave it
  url_key text NOT NULL,                                 -- for spotting duplicates: no fragment, no tracking parameters
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  pinned boolean NOT NULL DEFAULT false,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'ring')),
  ring_id text REFERENCES rings (id),
  favicon bytea,                                         -- a 32-pixel WebP, re-encoded
  checked_at timestamptz,
  link_ok boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  hidden_at timestamptz,
  hidden_reason text,
  search tsvector NOT NULL DEFAULT ''::tsvector,
  CHECK ((visibility = 'ring') = (ring_id IS NOT NULL))
);
CREATE UNIQUE INDEX bookmarks_user_key ON bookmarks (user_id, url_key);
CREATE INDEX bookmarks_user_recent ON bookmarks (user_id, created_at DESC, id DESC);
CREATE INDEX bookmarks_tags ON bookmarks USING gin (tags);
CREATE INDEX bookmarks_search ON bookmarks USING gin (search);

-- The tags live in an array, so the search text is kept by a trigger (a generated column can't use array_to_string).
CREATE FUNCTION bookmarks_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search := to_tsvector('simple', NEW.title || ' ' || NEW.description || ' ' || regexp_replace(NEW.url, '[/:.?=&_-]+', ' ', 'g') || ' ' || array_to_string(NEW.tags, ' '));
  RETURN NEW;
END $$;
CREATE TRIGGER bookmarks_search BEFORE INSERT OR UPDATE OF title, description, url, tags ON bookmarks FOR EACH ROW EXECUTE FUNCTION bookmarks_search();
