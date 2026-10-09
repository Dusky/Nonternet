-- E4 (docs/23): per-person archive and star on a conversation, and a system line when a group is renamed.
ALTER TABLE mail_participants ADD COLUMN archived_at timestamptz;
ALTER TABLE mail_participants ADD COLUMN starred_at timestamptz;

ALTER TABLE mail_messages DROP CONSTRAINT IF EXISTS mail_messages_kind_check;
ALTER TABLE mail_messages ADD CONSTRAINT mail_messages_kind_check CHECK (kind IN ('message', 'joined', 'left', 'renamed'));
