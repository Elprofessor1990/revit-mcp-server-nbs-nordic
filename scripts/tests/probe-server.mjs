// Deliberately not a Revit bridge. Used only by test-verify-install.mjs.
import { createInterface } from 'node:readline';
const scenario = process.env.INSTALLER_PROBE_TEST;
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined || scenario === 'silent') return;
  let result = {};
  if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } };
  if (request.method === 'tools/list') result = { tools: [{ name: 'get_project_info' }] };
  if (request.method === 'tools/call') result = { content: [{ type: 'text', text: JSON.stringify({
    success: scenario === 'success', response: scenario === 'success' ? { isWorkshared: false } : undefined,
    message: 'Fixture failure',
  }) }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
