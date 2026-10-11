import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { render } from 'ink';
import { parse } from 'yaml';
import { readExisting } from '../apply';
import { nodeProbes } from '../probes-node';
import { systemRandom } from '../secrets';
import { Wizard } from './Wizard';

// Starts the wizard on the real terminal. A re-run fills every step with the last install's answers.
export async function runWizard(o: { deployDir: string; hostDeployDir: string; dryRun: boolean }): Promise<number> {
  const existing = await readExisting(o.deployDir);
  const previous = await fs.readFile(join(o.deployDir, 'install', 'answers.used.yaml'), 'utf8').then((t) => parse(t) as unknown, () => undefined);
  let code = 0;
  const app = render(<Wizard deployDir={o.deployDir} hostDeployDir={o.hostDeployDir} probes={nodeProbes(o.deployDir)} rand={systemRandom} existing={existing} previous={previous} dryRun={o.dryRun} onDone={(c) => { code = c; }} />);
  await app.waitUntilExit();
  // Printed outside the frame, on a line of its own, so it can be copied whole.
  const url = code === 0 && !o.dryRun ? await fs.readFile(join(o.deployDir, 'install', 'setup-url'), 'utf8').catch(() => '') : '';
  if (url.trim()) console.log(`\nMake the first admin here once the site is up (the link works once):\n\n  ${url.trim()}\n`);
  return code;
}
