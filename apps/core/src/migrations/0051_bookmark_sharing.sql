-- Sharing bookmarks (docs/21, B3): public ones and ring ones can be reported, and leaving a ring makes its bookmarks private.
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('post', 'homepage', 'guestbook', 'mail_message', 'file', 'wiki_page', 'bookmark'));

CREATE INDEX bookmarks_shared ON bookmarks (visibility, created_at DESC) WHERE visibility <> 'private';
CREATE INDEX bookmarks_ring ON bookmarks (ring_id, created_at DESC) WHERE ring_id IS NOT NULL;

-- One rule for every way out of a ring (leaving, being removed or banned, the account going): the person's bookmarks in
-- that ring go back to being private.
CREATE FUNCTION bookmarks_leave_ring() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.status <> 'member' THEN
    UPDATE bookmarks SET visibility = 'private', ring_id = NULL, updated_at = now() WHERE user_id = OLD.user_id AND ring_id = OLD.ring_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER bookmarks_leave_ring AFTER DELETE OR UPDATE OF status ON ring_members FOR EACH ROW EXECUTE FUNCTION bookmarks_leave_ring();
