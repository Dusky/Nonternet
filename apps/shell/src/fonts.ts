// The type the themes use (docs/10), bundled with the shell so nothing is fetched from elsewhere (CSP font-src 'self').
// All are under the SIL Open Font License (docs/17, V10). A browser downloads a face only when a theme uses it.
// Bricolage is variable (weight 200-800 and optical size), so body text gets its text cut and a real regular weight.
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import '@fontsource/vt323/400.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/nunito-sans/800.css';
import '@fontsource/silkscreen/400.css';
// The Terminal's optional old PC font: CC BY-SA 4.0, not OFL; see assets/fonts/vga/README.md.
import './assets/fonts/vga/vga.css';
