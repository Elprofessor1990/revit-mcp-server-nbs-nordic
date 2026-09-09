import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
mkdirSync('.test-build', { recursive: true });
await build({ entryPoints: ['tests/nbs-connection.test.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/nbs.test.mjs' });
const result = spawnSync(process.execPath, ['--test', '.test-build/nbs.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
