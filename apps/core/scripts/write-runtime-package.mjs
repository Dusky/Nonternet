// Native modules can't be bundled. The build leaves them external and writes dist/package.json
// so the runtime image can `npm install` exactly the version this workspace was tested with.
import { readFileSync, writeFileSync } from 'node:fs';

// graphile-worker reads its own SQL migrations from its package folder, so it is installed rather than bundled too.
const EXTERNAL = ['@node-rs/argon2', 'sharp', 'graphile-worker'];
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dependencies = {};
for (const name of EXTERNAL) {
  const installed = JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8'));
  dependencies[name] = installed.version;
}
writeFileSync(new URL('../dist/package.json', import.meta.url), JSON.stringify({ name: 'core-runtime', private: true, dependencies }, null, 2) + '\n');
console.log('wrote dist/package.json', dependencies, pkg.name);
