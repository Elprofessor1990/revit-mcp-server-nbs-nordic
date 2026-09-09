// Read-only by default. --connect <projectId> <modelPath> explicitly binds a model.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'nbs-live-check', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./build/index.js', import.meta.url))],
  stderr: 'ignore',
});
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(JSON.stringify({ registeredTools: tools.length, newTools: tools.filter(t => ['get_connection_status', 'nbs_connect_project', 'nbs_clone_project'].includes(t.name)).map(t => t.name) }));
  const statusResult = await client.callTool({ name: 'get_connection_status', arguments: {} }, undefined, { timeout: 45000 });
  console.log(JSON.stringify(statusResult, null, 2));
  if (process.argv[2] === '--preview-modes') {
    const syncTool = tools.find(t => t.name === 'sync_revit_types_to_nbs');
    if (!syncTool?.inputSchema.required?.includes('linkMode')) throw new Error('Server does not expose required link modes.');
    for (const linkMode of ['typeOnly', 'instanceOnly', 'typeAndInstance']) {
      const result = await client.callTool({ name: 'sync_revit_types_to_nbs', arguments: {
        category: 'OST_Walls', linkMode, dryRun: true,
      } }, undefined, { timeout: 60000 });
      if (result.isError) { console.log(JSON.stringify({ linkMode, error: result })); process.exitCode = 1; continue; }
      const report = JSON.parse(result.content.find(c => c.type === 'text').text);
      console.log(JSON.stringify({ linkMode: report.linkMode, dryRun: report.dryRun, projectId: report.projectId,
        instances: report.instances, typesToUpdate: report.typesToUpdate, instancesToUpdate: report.instancesToUpdate,
        parametersToUpdate: report.parametersToUpdate, unresolvedTypes: report.unresolvedTypes?.length,
        inspectedInstanceLinks: report.instanceMatches?.length, nativeNbsSettingsChanged: report.nativeNbsSettingsChanged,
      }));
    }
  }
  if (process.argv[2] === '--connect') {
    const projectId = process.argv[3];
    const modelPath = process.argv[4];
    if (!/^\d+$/.test(projectId ?? '') || !modelPath) throw new Error('Supply project ID and expected model path.');
    const status = JSON.parse(statusResult.content.find(c => c.type === 'text').text);
    if (status.revit.filePath?.toLowerCase() !== modelPath.toLowerCase()) throw new Error('Active model does not match the requested file.');
    const connected = await client.callTool({ name: 'nbs_connect_project', arguments: { projectId, expectedModelKey: status.revit.modelKey } }, undefined, { timeout: 45000 });
    console.log(JSON.stringify({ connection: connected }, null, 2));
    if (connected.isError) throw new Error('Connection failed; no sync attempted.');
    console.log(JSON.stringify(await client.callTool({ name: 'get_connection_status', arguments: {} }, undefined, { timeout: 45000 }), null, 2));
    console.log(JSON.stringify(await client.callTool({ name: 'sync_revit_types_to_nbs', arguments: { category: 'OST_Walls', projectId, linkMode: 'typeAndInstance', dryRun: true } }, undefined, { timeout: 60000 }), null, 2));
  }
} finally {
  await client.close();
}
