import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

mkdirSync(".test-build", { recursive: true });
await build({ entryPoints: ["tests/agent/routing.test.ts"], bundle: true,
  platform: "node", format: "esm", outfile: ".test-build/agent-routing.test.mjs" });
const result = spawnSync(process.execPath, ["--test", ".test-build/agent-routing.test.mjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
