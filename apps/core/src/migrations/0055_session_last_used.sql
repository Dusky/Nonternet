-- When each session was last used (to the nearest few minutes), for the person's list of where they are signed in.
ALTER TABLE sessions ADD COLUMN last_used_at timestamptz;
