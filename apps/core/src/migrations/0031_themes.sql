-- The 2026-10 restyle (docs/10, 17): five themes replace Modern and Amber. Saved choices move to their successors,
-- and the Terminal theme's colour scheme is kept beside the theme. Null still means the site default.
UPDATE users SET theme = 'webring' WHERE theme = 'modern';
UPDATE users SET theme = 'terminal' WHERE theme = 'amber';
ALTER TABLE users ADD COLUMN theme_variant text;
UPDATE settings_current SET value = '"webring"'::jsonb WHERE key = 'ui.default_theme' AND value = '"modern"'::jsonb;
UPDATE settings_current SET value = '"terminal"'::jsonb WHERE key = 'ui.default_theme' AND value = '"amber"'::jsonb;
