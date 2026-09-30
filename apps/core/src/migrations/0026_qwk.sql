-- QWK offline mail (docs/04, M8). Each person's boards get fixed conference numbers, so replies in a REP
-- packet come back to the right board; each REP is taken once.
CREATE TABLE qwk_conferences (
  user_id text NOT NULL REFERENCES users (id),
  board_id text NOT NULL REFERENCES boards (id),
  conf integer NOT NULL CHECK (conf BETWEEN 1 AND 9999),
  PRIMARY KEY (user_id, board_id),
  UNIQUE (user_id, conf)
);

CREATE TABLE qwk_uploads (
  user_id text NOT NULL REFERENCES users (id),
  sha256 text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  posted integer NOT NULL,
  PRIMARY KEY (user_id, sha256)
);
