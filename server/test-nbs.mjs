import { build } from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
mkdirSync('.test-build', { recursive: true });
await build({ entryPoints: ['tests/nbs-connection.test.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/nbs.test.mjs' });
// ClassificationLookup.ts resolves cci-hierarchy.json relative to its own module
// directory at runtime (same as the production build in esbuild.config.mjs does
// for build/), so the bundled test also needs its own copy alongside it.
copyFileSync('src/integrations/nbs/classification/cci-hierarchy.json', '.test-build/cci-hierarchy.json');
const result = spawnSync(process.execPath, ['--test', '.test-build/nbs.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
