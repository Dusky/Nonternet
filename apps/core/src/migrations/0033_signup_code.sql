-- Signing up from the terminal (docs/02, docs/04, 2026-10-02): the confirmation email also carries a short
-- code someone can type at the BBS prompt. Kept hashed, like the link; five wrong tries and it stops working.
ALTER TABLE email_verifications ADD COLUMN code_hash text;
ALTER TABLE email_verifications ADD COLUMN code_tries int NOT NULL DEFAULT 0;
CREATE INDEX email_verifications_user ON email_verifications (user_id, expires_at DESC);
