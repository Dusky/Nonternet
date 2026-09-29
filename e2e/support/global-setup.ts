import { startStack } from './stack';

export default async function globalSetup() {
  return await startStack(); // Playwright runs the function we return once every test has finished
}
