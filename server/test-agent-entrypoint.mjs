import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

mkdirSync(".test-build", { recursive: true });
await build({ entryPoints: ["tests/agent/entrypoint.test.ts"], bundle: true,
  platform: "node", format: "esm", external: ["sql.js"],
  outfile: ".test-build/agent-entrypoint.test.mjs" });
const result = spawnSync(process.execPath, ["--test", ".test-build/agent-entrypoint.test.mjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
