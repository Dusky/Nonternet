// The full-screen wizard comes in the next step (INS3).
export async function runWizard(_o: { deployDir: string; hostDeployDir: string; dryRun: boolean }): Promise<number> {
  console.log('The wizard is not built yet. Use --answers answers.yaml for now (see deploy/install.example.yaml).');
  return 2;
}
