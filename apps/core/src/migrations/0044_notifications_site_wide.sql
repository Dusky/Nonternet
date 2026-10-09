-- Notifications for more than board posts (docs/23, E2): mail, reactions and ring events.
-- A notification now points at its thing by `ref` (a mail conversation, a ring, a reacted post) and a row for a
-- repeated event is kept once and counted ("3 reactions") while it is unread, instead of making a row each time.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ALTER COLUMN post_id DROP NOT NULL;
ALTER TABLE notifications ALTER COLUMN board_id DROP NOT NULL;
ALTER TABLE notifications ADD COLUMN ref text;
ALTER TABLE notifications ADD COLUMN count integer NOT NULL DEFAULT 1 CHECK (count >= 1);
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reply', 'mention', 'watch', 'mail', 'reaction', 'ring_invite', 'ring_request', 'ring_joined'));
-- One notification per person per post, for the kinds a post makes (a reaction row is about the reacted post).
ALTER TABLE notifications DROP CONSTRAINT notifications_user_id_post_id_key;
CREATE UNIQUE INDEX notifications_post_once ON notifications (user_id, post_id)
  WHERE post_id IS NOT NULL AND kind IN ('reply', 'mention', 'watch');
-- While one is unread, more of the same (same kind, same thing) add to it.
CREATE UNIQUE INDEX notifications_unread_group ON notifications (user_id, kind, ref)
  WHERE ref IS NOT NULL AND read_at IS NULL;
