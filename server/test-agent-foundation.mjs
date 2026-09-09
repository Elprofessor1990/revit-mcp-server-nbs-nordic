import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

mkdirSync(".test-build", { recursive: true });
await build({
  entryPoints: ["tests/agent-foundation.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["sql.js"],
  outfile: ".test-build/agent-foundation.test.mjs",
});
copyFileSync("node_modules/sql.js/dist/sql-wasm.wasm", ".test-build/sql-wasm.wasm");
const result = spawnSync(
  process.execPath,
  ["--test", ".test-build/agent-foundation.test.mjs"],
  { stdio: "inherit" }
);
process.exitCode = result.status ?? 1;
