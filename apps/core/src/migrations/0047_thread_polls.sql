-- E3b (docs/23): a poll can belong to a thread (a board post). It uses the voting booth's tables.
ALTER TABLE polls ADD COLUMN post_id text REFERENCES posts (id);
CREATE UNIQUE INDEX polls_post ON polls (post_id) WHERE post_id IS NOT NULL;
