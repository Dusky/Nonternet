-- Sharing memos (docs/22, M3): reactions, notifications for replies and reactions, reports, and ring exits.
CREATE TABLE memo_reactions (
  memo_id text NOT NULL REFERENCES memos (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users (id),
  reaction text NOT NULL CHECK (reaction IN ('agree', 'thanks', 'funny', 'interesting', 'sad', 'love')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (memo_id, user_id, reaction)
);
CREATE INDEX memo_reactions_user ON memo_reactions (user_id);

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reply', 'mention', 'watch', 'mail', 'reaction', 'ring_invite', 'ring_request', 'ring_joined', 'memo_reply', 'memo_reaction'));

ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('post', 'homepage', 'guestbook', 'mail_message', 'file', 'wiki_page', 'bookmark', 'memo'));

CREATE INDEX memos_shared ON memos (visibility, created_at DESC) WHERE visibility <> 'private' AND reply_to IS NULL;
CREATE INDEX memos_ring ON memos (ring_id, created_at DESC) WHERE ring_id IS NOT NULL;
CREATE INDEX memos_replies ON memos (reply_to, created_at) WHERE reply_to IS NOT NULL;

-- Leaving a ring (or being removed or banned, or the account going) turns that person's ring memos back to private. Replies keep
-- no sharing of their own: they are readable only while the memo they answer is.
CREATE FUNCTION memos_leave_ring() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.status <> 'member' THEN
    UPDATE memos SET visibility = 'private', ring_id = NULL WHERE user_id = OLD.user_id AND ring_id = OLD.ring_id AND reply_to IS NULL;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER memos_leave_ring AFTER DELETE OR UPDATE OF status ON ring_members FOR EACH ROW EXECUTE FUNCTION memos_leave_ring();
