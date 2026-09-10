import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const probe = fileURLToPath(new URL('./verify-install.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('./tests/probe-server.mjs', import.meta.url));
for (const scenario of ['success', 'failure', 'silent']) {
  test(`probe ${scenario}: verifies result, not just MCP handshake`, async () => {
    const child = spawn(process.execPath, [probe, fixture, '1'], {
      windowsHide: true, env: { ...process.env, INSTALLER_PROBE_TEST: scenario },
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    assert.equal(code, scenario === 'success' ? 0 : 1, output);
    assert.match(output, scenario === 'success' ? /Revit API response verified/ : /timed out|NOT verified/);
  });
}
