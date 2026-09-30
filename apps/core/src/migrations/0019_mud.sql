-- Announcements can also go to everyone in the MUD (docs/09); this marks when they were sent there.
ALTER TABLE announcements ADD COLUMN mud_sent_at timestamptz;
