-- E5 (docs/23): a few optional plain-text fields on a profile.
ALTER TABLE users ADD COLUMN pronouns text;
ALTER TABLE users ADD COLUMN location text;
ALTER TABLE users ADD COLUMN links jsonb NOT NULL DEFAULT '[]';
