-- Homepage toys (M9-E, docs/07): "sign with your account" guestbook tickets and ring banners.

-- A one-use, ten-minute pass that says "this signed-in person is signing that homepage's guestbook". The homepage
-- lives on another address and sees no cookies, so the pass is carried back to it in the link. Only a hash is kept.
CREATE TABLE guestbook_tickets (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id),
  home_user_id text NOT NULL REFERENCES users (id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX guestbook_tickets_expiry ON guestbook_tickets (expires_at);

-- A ring's two banners: 468x60 and 88x31. The picture is drawn again on upload and stored beside avatars.
CREATE TABLE ring_banners (
  ring_id text NOT NULL REFERENCES rings (id),
  kind text NOT NULL CHECK (kind IN ('468x60', '88x31')),
  uploaded_by text REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  hidden_at timestamptz,                                -- an admin or ring op took it down
  PRIMARY KEY (ring_id, kind)
);
