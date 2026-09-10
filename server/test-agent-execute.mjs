import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
mkdirSync(".test-build", { recursive: true });
await build({ entryPoints: ["tests/agent/execute.test.ts"], bundle: true,
  platform: "node", format: "esm", external: ["sql.js"], outfile: ".test-build/agent-execute.test.mjs",
  plugins: [{ name: "offline-boundaries", setup(build) {
    build.onResolve({ filter: /(?:ConnectionManager|NbsClient|tokenLogger)\.js$|\/database\/db\.js$/ }, () =>
      ({ path: resolve("tests/agent/orchestrator-fixture.ts") }));
  } }],
});
const result = spawnSync(process.execPath, ["--test", ".test-build/agent-execute.test.mjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
