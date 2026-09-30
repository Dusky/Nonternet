// Native modules can't be bundled. The build leaves them external and writes dist/package.json
// so the runtime image can `npm install` exactly the version this workspace was tested with.
import { readFileSync, writeFileSync } from 'node:fs';

const EXTERNAL = ['ssh2']; // ssh2 has optional native parts (cpu-features) and is installed, not bundled
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dependencies = {};
for (const name of EXTERNAL) {
  const installed = JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8'));
  dependencies[name] = installed.version;
}
writeFileSync(new URL('../dist/package.json', import.meta.url), JSON.stringify({ name: 'bbs-runtime', private: true, dependencies }, null, 2) + '\n');
console.log('wrote dist/package.json', dependencies, pkg.name);
