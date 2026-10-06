# The site's own wallpapers

Pictures put here can be offered as desktop wallpapers in Settings → Appearance, next to the drawn patterns.
Core reads this folder as `WALLPAPERS_DIR` (mounted read-only by `compose.yaml`).

1. Copy a picture here (PNG, JPEG, WebP, GIF or AVIF). Keep it reasonably small: about 2560 px wide and
   under 500 KB for a picture that fills the screen; a tile can be tiny.
2. List it in the site config:

   ```yaml
   ui:
     wallpapers:
       - { id: hills, name: Hills, file: hills.webp, fit: cover }   # fills the screen
       - { id: stars, name: Stars, file: stars.png, fit: tile }     # repeats
     default_wallpaper: preset:hills   # or dots, grid, stripes, plain
   ```

3. Restart core. Admins can change the default later in the console (Settings → The wallpaper for people who
   have not picked one).

Taking a picture out of the list moves anyone using it back to the default. Only pictures listed in the config
are served; anything else in this folder is ignored.
