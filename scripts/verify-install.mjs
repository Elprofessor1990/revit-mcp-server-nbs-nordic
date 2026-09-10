// Read-only end-to-end MCP probe; no dependencies beyond Node.js.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verifyInstallation(serverPath, timeoutSeconds = 180) {
  const child = spawn(process.execPath, [resolve(serverPath)], {
    cwd: dirname(resolve(serverPath)), windowsHide: true,
    env: { ...process.env, REVIT_MCP_TOOL_AGENT_ENABLED: 'false' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let nextId = 0;
  let diagnostic = '';
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  const rejectPending = message => {
    for (const { reject } of pending.values()) reject(new Error(message));
    pending.clear();
  };
  child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(-2000); });
  child.on('error', error => rejectPending(error.message));
  child.on('exit', code => rejectPending(`MCP server exited (${code}). ${diagnostic}`));
  child.stdin.on('error', error => rejectPending(error.message));
  lines.on('line', line => {
    let response;
    try { response = JSON.parse(line); } catch { return; }
    const waiting = pending.get(response.id);
    if (!waiting) return;
    pending.delete(response.id);
    if (response.error) waiting.reject(new Error(response.error.message));
    else waiting.resolve(response.result);
  });
  const send = (method, params, id) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params, ...(id === undefined ? {} : { id }) }) + '\n');
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    send(method, params, id);
  });
  let lastError = 'No response yet';
  const timer = setTimeout(() => {
    rejectPending(`Live Revit verification timed out: ${lastError}`);
    child.kill();
  }, timeoutSeconds * 1000);
  const deadline = Date.now() + timeoutSeconds * 1000;
  try {
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'revit-nbs-installer-check', version: '1.0' } });
    send('notifications/initialized', {});
    const catalog = await request('tools/list', {});
    if (!catalog.tools?.some(tool => tool.name === 'get_project_info')) throw new Error('MCP server does not expose get_project_info.');
    console.log('  [+] MCP initialize + tools/list responded. Checking live Revit API...');
    do {
      const result = await request('tools/call', { name: 'get_project_info', arguments: {
        includePhases: false, includeWorksets: false, includeLinks: false, includeLevels: false,
      } });
      const text = result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n');
      let data;
      try { data = JSON.parse(text); } catch { /* Tool errors are often plain text. */ }
      const payload = data?.response ?? data?.Response;
      if (!result.isError && (data?.success ?? data?.Success) === true && typeof payload?.isWorkshared === 'boolean') {
        console.log('  [+] Live MCP -> TCP -> plugin -> Revit API response verified (get_project_info).');
        return;
      }
      lastError = text || 'Unexpected project-info response';
      console.log('  [!] Revit not ready. Open Revit/project and close any modal dialog; retrying...');
      await new Promise(resolve => setTimeout(resolve, Math.min(2000, Math.max(0, deadline - Date.now()))));
    } while (Date.now() < deadline && child.exitCode === null && !child.killed);
    throw new Error(`Live Revit connection NOT verified: ${lastError}`);
  } finally {
    clearTimeout(timer);
    lines.close();
    child.kill();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const seconds = Number(process.argv[3] ?? 180);
  if (!process.argv[2] || !Number.isFinite(seconds) || seconds < 1 || seconds > 600) {
    console.error('Usage: node verify-install.mjs <server/build/index.js> [timeout-seconds: 1..600]');
    process.exitCode = 1;
  } else {
    try { await verifyInstallation(process.argv[2], seconds); }
    catch (error) { console.error(`  [-] ${error.message}`); process.exitCode = 1; }
  }
}
