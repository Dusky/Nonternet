-- The Studio's live preview (docs/07, 2026-10-05): the unsaved text of the file being edited, held so the homepage origin
-- can show it exactly as it will look, at an address only the editor knows (the token). One row per person, replaced as they
-- type and ignored after ten minutes. Saving writes the real file; this is never published.
CREATE TABLE home_previews (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL,
  path text NOT NULL,
  body text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
