-- Personal touches (M9-D, docs/10, 12): a status line, an avatar, who may see when you were last here,
-- what you are told about, and conversations you have muted.

ALTER TABLE users
  ADD COLUMN status_line text,                                  -- up to 80 characters, shown on the profile and in who's online
  ADD COLUMN away boolean NOT NULL DEFAULT false,
  ADD COLUMN avatar_at timestamptz,                             -- when the avatar was last set; NULL means initials
  ADD COLUMN show_last_seen boolean NOT NULL DEFAULT true,      -- coarse "today / this week" on the profile
  ADD COLUMN email_digest boolean NOT NULL DEFAULT false,       -- a daily summary of what you missed, if the site can send mail
  ADD COLUMN digest_sent_at timestamptz;

-- One row per kind the person has changed from the default (everything on). `site`: a notification appears on the
-- site. `desktop`: a browser alert may be raised for it (the browser still has to be allowed to).
CREATE TABLE notification_prefs (
  user_id text NOT NULL REFERENCES users (id),
  kind text NOT NULL,
  site boolean NOT NULL DEFAULT true,
  desktop boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, kind)
);

-- Boards the person has muted: nothing from them, except when someone mentions them.
CREATE TABLE board_notification_prefs (
  user_id text NOT NULL REFERENCES users (id),
  board_id text NOT NULL REFERENCES boards (id),
  PRIMARY KEY (user_id, board_id)
);

-- Mail conversations the person has muted: they stay in the inbox but stop counting as unread in the badge.
CREATE TABLE mail_mutes (
  user_id text NOT NULL REFERENCES users (id),
  thread_id text NOT NULL REFERENCES mail_threads (id),
  PRIMARY KEY (user_id, thread_id)
);
