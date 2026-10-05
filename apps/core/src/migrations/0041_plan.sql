-- A person's .plan (docs/02, decided 2026-10-05): a few lines of plain text about what they are up to, shown by finger,
-- on their profile and in the Gemini mirror. Theirs, so it is in the export.
ALTER TABLE users ADD COLUMN plan text NOT NULL DEFAULT '';
