-- The MUD's tower (docs/18): each character's climb this season, copied with the rest of the sheet, for the site's leaderboard.
ALTER TABLE mud_characters
  ADD COLUMN tower_season integer,
  ADD COLUMN tower_best integer NOT NULL DEFAULT 0,
  ADD COLUMN tower_checkpoint integer NOT NULL DEFAULT 0;
CREATE INDEX mud_characters_tower ON mud_characters (tower_season, tower_best DESC);
