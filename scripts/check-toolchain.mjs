import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const root = new URL('../', import.meta.url);
const expectedNode = readFileSync(new URL('.node-version', root), 'utf8').trim();
const { packageManager } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const expectedPnpm = packageManager.split('@')[1];
const actualPnpm = process.env.npm_config_user_agent?.split(' ')[0];

if (process.versions.node !== expectedNode || actualPnpm !== `pnpm/${expectedPnpm}`) {
  console.error(
    `Use Node ${expectedNode} and corepack pnpm ${expectedPnpm} from the repository root. ` +
      `Observed Node ${process.versions.node}, package manager ${actualPnpm ?? 'unknown'}.`,
  );
  process.exitCode = 1;
} else {
  console.log(`Toolchain verified: Node ${expectedNode}, pnpm ${expectedPnpm}.`);
}
