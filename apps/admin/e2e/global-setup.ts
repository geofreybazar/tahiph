import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const API = resolve(import.meta.dirname, '../../api');
const fixture = (...args: string[]) =>
  execFileSync('npx', ['tsx', 'prisma/e2e-fixture.ts', ...args], { cwd: API, stdio: 'inherit' });

/** Creates the throwaway tenants, and returns the step that removes them after the run. */
export default function globalSetup() {
  fixture('up', resolve(import.meta.dirname, '.run.json'));
  return () => fixture('down');
}
