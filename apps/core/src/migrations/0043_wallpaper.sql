-- The desktop wallpaper (docs/10), kept on the account. NULL choice: the person never chose (the shell uses dots).
ALTER TABLE users
  ADD COLUMN wallpaper text,
  ADD COLUMN wallpaper_fit text NOT NULL DEFAULT 'cover' CHECK (wallpaper_fit IN ('cover', 'tile', 'center')),
  ADD COLUMN wallpaper_at timestamptz,   -- when their own picture was last set; NULL when they have none
  ADD COLUMN wallpaper_url text;         -- where it was copied from, when it came from a web address
