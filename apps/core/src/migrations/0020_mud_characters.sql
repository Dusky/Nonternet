-- MUD characters, as core knows them (docs/09): a copy pulled from the MUD so boards, profiles and anything
-- else on the site can show them without asking the MUD on every page. The MUD is the source of truth.
CREATE TABLE mud_characters (
  id text PRIMARY KEY,                                  -- c_<the MUD's object id>, stable for the character's life
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL,
  level integer NOT NULL DEFAULT 1,
  xp integer NOT NULL DEFAULT 0,
  hp integer NOT NULL DEFAULT 0,
  hp_max integer NOT NULL DEFAULT 0,
  coins integer NOT NULL DEFAULT 0,
  abilities jsonb NOT NULL DEFAULT '{}',                -- strength, dexterity, constitution, intelligence, wisdom, charisma
  -- Not where the character is: that would tell everyone where the person is right now.
  created_at timestamptz NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mud_characters_user ON mud_characters (user_id);

-- The character a person shows next to their name around the site, if any.
ALTER TABLE users ADD COLUMN featured_character_id text REFERENCES mud_characters (id) ON DELETE SET NULL;
