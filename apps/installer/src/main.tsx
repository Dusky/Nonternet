import { headless } from './headless';
import { nodeProbes } from './probes-node';
import { systemRandom } from './secrets';

// The installer (docs/19). sitectl runs it in a container with the deploy folder mounted at /deploy.
//   install                      the wizard
//   install --answers file.yaml  the same install, no questions (add --dry-run to only show what would change)
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const value = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const deployDir = value('deploy-dir') ?? process.env.DEPLOY_DIR ?? '/deploy';
const hostDeployDir = process.env.HOST_DEPLOY_DIR ?? deployDir;

async function main(): Promise<number> {
  const answersFile = value('answers');
  if (answersFile) {
    return headless({ answersFile, deployDir, hostDeployDir, dryRun: flag('dry-run'), force: flag('force'), skipChecks: flag('skip-checks') }, nodeProbes(deployDir), systemRandom, (l) => console.log(l));
  }
  const { runWizard } = await import('./wizard/run');
  return runWizard({ deployDir, hostDeployDir, dryRun: flag('dry-run') });
}

main().then((code) => process.exit(code), (e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
