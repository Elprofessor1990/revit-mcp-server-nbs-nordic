import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import initSqlJs from "sql.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerOrchestrateWorkflowTool, PLAN_CATALOG_VERSION } from "../../src/tools/orchestrate_workflow.js";
import { readAgentConfig } from "../../src/agent/AgentConfig.js";
import { ConfirmedWorkflowService } from "../../src/agent/ConfirmedWorkflowService.js";
import { ToolCatalog, ROUTING_TOOL_IDS } from "../../src/agent/ToolCatalog.js";
import { fixture } from "./orchestrator-fixture.js";

const intent = "Ændr højden på de valgte vægge til 3200 mm.";
const request = { intentKind: "wall_height" as const, height: 3200, unit: "mm" as const };
function offline(fail = false) {
  let height = 10, writes = 0, reads = 0;
  const p = (name: string, value: unknown, storageType: string) => ({ name, value, storageType, isReadOnly: false, isShared: false, hasValue: true });
  fixture.request = async () => { throw new Error("Unexpected NBS request"); };
  fixture.command = async (name, args) => {
    reads++;
    if (name === "nbs_project" && args.operation === "status") return { modelKey: "fixture", projectId: "10", isReadOnly: false, missingParameters: [] };
    if (name === "get_selected_elements") return [{ Id: 1, UniqueId: "wall", Name: "Wall", Category: "Walls" }];
    if (name === "get_available_family_types") return [{ FamilyTypeId: 10, UniqueId: "type", FamilyName: "Basic Wall", TypeName: "Wall", Category: "Walls" }];
    if (name === "get_element_parameters") return { Success: true, Response: [{ elementId: 1, elementName: "Wall", category: "Walls",
      parameters: [p("Type", 10, "ElementId"), p("Unconnected Height", height, "Double"), p("Top Constraint", -1, "ElementId"),
        p("Top is Attached", 0, "Integer"), p("Base is Attached", 0, "Integer")] }] };
    if (name === "set_element_parameters") {
      writes++;
      if (!fail) height = args.requests[0].value;
      return { Success: true, Response: [{ elementId: 1, parameterName: "Unconnected Height", success: true }] };
    }
    throw new Error(`Unexpected fixture command ${name}`);
  };
  return { writes: () => writes, reads: () => reads };
}
async function session() {
  const dir = mkdtempSync(join(tmpdir(), "execute-test-"));
  const config = readAgentConfig({}, dir);
  const server = new McpServer({ name: "execute-test", version: "1" });
  registerOrchestrateWorkflowTool(server, config);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  return { config, dir, async call(args: Record<string, unknown>) {
    const result = await client.callTool({ name: "orchestrate_workflow", arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    return JSON.parse((result.content as { text: string }[])[0].text);
  }, async rows() {
    const SQL = await initSqlJs(); const db = new SQL.Database(readFileSync(config.workflowCachePath));
    try { const stmt = db.prepare("SELECT * FROM workflow_cache"); const rows: any[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); return rows;
    } finally { db.close(); }
  }, async close() { await client.close(); await server.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function execute(p: any) { return { mode: "execute", planId: p.confirmation.planId, plan: p.plan, confirmed: true }; }
for (const fail of [false, true]) test(`MCP plan→execute ${fail ? "failure" : "success"}: real runtime, full WorkflowRun, persisted cache feedback`, async () => {
  const state = offline(fail); const s = await session();
  try {
    const planned = await s.call({ mode: "plan", intent, request });
    assert.equal(state.reads(), 0); assert.equal(existsSync(s.config.workflowCachePath), false);
    assert.deepEqual(planned.confirmation.request, request);
    const run = await s.call(execute(planned));
    assert.equal(run.status, fail ? "failure" : "success"); assert.equal(run.verified, !fail);
    assert.equal(run.completedSteps, fail ? 3 : 4); assert.equal(run.mutationState, "may_have_changes");
    assert.equal(typeof run.runId, "string"); assert.equal(run.cacheFeedback, "recorded");
    if (fail) assert.equal(run.error.stage, "verify");
    assert.equal(state.writes(), 1);
    if (!fail) assert.equal(state.reads(), 21, "offline baseline: 21 bridge commands for four wall workflow steps");
    const rows = await s.rows(); assert.equal(rows.length, 1);
    assert.equal(rows[0].success_count, fail ? 0 : 1); assert.equal(rows[0].failure_count, fail ? 1 : 0);
    assert.deepEqual(JSON.parse(rows[0].plan_json), planned.plan);
    assert.ok(!rows[0].plan_json.includes("3200"));
    await assert.rejects(s.call(execute(planned)), /consumed/);
    assert.equal(state.writes(), 1);
  } finally { await s.close(); }
});
test("missing prior plan, tampered plan, request override and missing confirmation never invoke handlers", async () => {
  const state = offline(); const s = await session();
  try {
    const p = await s.call({ mode: "plan", intent, request });
    await assert.rejects(s.call({ ...execute(p), planId: "00000000-0000-4000-8000-000000000000" }));
    const changed = structuredClone(p); changed.plan.steps[2].argsTemplate.requests = [];
    await assert.rejects(s.call(execute(changed)), /plan/);
    await assert.rejects(s.call({ ...execute(p), request: { ...request, height: 1 } }), /overrides/);
    await assert.rejects(s.call({ ...execute(p), confirmed: undefined }));
    await assert.rejects(s.call({ mode: "execute", intent }));
    await assert.rejects(s.call({ mode: "plan", intent, request: { ...request, height: 1 } }), /height/);
    assert.equal(state.reads(), 0);
  } finally { await s.close(); }
});
test("confirmation is session-local and duplicate concurrent execution cannot replay", async () => {
  const state = offline(); const a = await session(), b = await session();
  try {
    const p = await a.call({ mode: "plan", intent, request });
    await assert.rejects(b.call(execute(p)), /Unknown/);
    const results = await Promise.allSettled([a.call(execute(p)), a.call(execute(p))]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(state.writes(), 1);
  } finally { await a.close(); await b.close(); }
});
test("expired/evicted confirmations are rejected without I/O", async () => {
  const state = offline(); let now = 0;
  const service = new ConfirmedWorkflowService(new ToolCatalog(PLAN_CATALOG_VERSION, ROUTING_TOOL_IDS), readAgentConfig(), () => now);
  const first = service.plan(intent, request) as any;
  now = first.confirmation.expiresAt;
  await assert.rejects(service.execute(first.confirmation.planId, first.plan), /expired/);
  const oldest = service.plan(intent, request) as any;
  for (let i = 0; i < 100; i++) service.plan(intent, request);
  await assert.rejects(service.execute(oldest.confirmation.planId, oldest.plan), /Unknown/);
  assert.equal(state.reads(), 0);
});
test("cache unavailable preserves complete successful run; audit unavailable prevents execution", async () => {
  const state = offline(); const s = await session();
  try {
    const blocker = join(s.dir, "not-a-directory"); writeFileSync(blocker, "fixture");
    s.config.workflowCachePath = join(blocker, "cache.db");
    const p = await s.call({ mode: "plan", intent, request });
    const run = await s.call(execute(p));
    assert.equal(run.status, "success"); assert.equal(run.verified, true); assert.equal(run.cacheFeedback, "unavailable");
    s.config.auditLogPath = join(blocker, "audit.db");
    const next = await s.call({ mode: "plan", intent, request });
    await assert.rejects(s.call(execute(next)));
    assert.equal(state.writes(), 1);
  } finally { await s.close(); }
});
