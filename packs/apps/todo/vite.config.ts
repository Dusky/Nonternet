import { defineConfig } from 'vite';

// An app package (docs/10): built into packs/build/<id>, which is what APPS_DIR points at. Relative paths, because
// the homes server serves it under /apps/<id>@<version>/. One small script and one stylesheet, nothing inline,
// so it runs under the app policy (no inline script).
export default defineConfig({
  base: './',
  build: { outDir: '../../build/todo', emptyOutDir: true, modulePreload: false, assetsInlineLimit: 0, target: 'es2022' },
});
