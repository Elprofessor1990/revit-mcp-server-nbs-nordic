import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { WorkflowOrchestrator, type WorkflowRuntime } from "../../src/agent/WorkflowOrchestrator.js";
import { ReviewedToolExecutor } from "../../src/agent/ReviewedToolExecutor.js";
import { RuleEngine } from "../../src/agent/RuleEngine.js";
import { IntentRouter } from "../../src/agent/IntentRouter.js";
import { ToolCatalog, ROUTING_TOOL_IDS } from "../../src/agent/ToolCatalog.js";
import { SqliteAuditSink } from "../../src/agent/audit/SqliteAuditSink.js";
import { fixture } from "./orchestrator-fixture.js";

const catalog = new ToolCatalog("fixture-v1", ROUTING_TOOL_IDS);
const rules = new RuleEngine(catalog);
function plan(intent: string) {
  const result = new IntentRouter(catalog).route(intent);
  assert.equal(result.status, "planned");
  if (result.status !== "planned") throw new Error("Fixture intent");
  return result.plan;
}
const wall = () => plan("Ændr højden på de valgte vægge til 3200 mm.");
const nbs = () => plan("Synkroniser bygningsdelsnummer L%AD001 fra NBS til de valgte Revit-elementer.");
const change = { targetKind: "parameter", targetId: "1/Height", oldValue: 10, newValue: 20 };
const runtime: WorkflowRuntime = {
  async prepare(context) { return { bindings: { selectedElementIds: [1], validatedHeightRequests: [{ elementId: 1, parameterName: "Height", value: 20 }],
    validatedCategory: "OST_Walls", expectedProjectId: "10", uniqueSelectedTypeIds: [1],
    findText: "Old", replaceText: "New", prefix: "", suffix: "",
    validatedScheduleFields: [{ parameterName: "Type", fieldType: "Type" }], scheduleName: "Walls", createdScheduleId: 99 },
    changes: context.step.phase === "write" && context.step.toolId !== "sync_revit_types_to_nbs" ? [change] : [] }; },
  async assess(context, result) { return context.step.phase !== "verify" || (result as { value?: number }).value === 20; },
};
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "orchestrator-test-"));
  const path = join(dir, "audit-log.db");
  const audit = await SqliteAuditSink.open({ filePath: path });
  return { audit, orchestrator: new WorkflowOrchestrator(rules, new ReviewedToolExecutor(), audit),
    async events() {
      const SQL = await initSqlJs();
      const db = new SQL.Database(readFileSync(path));
      try {
        const stmt = db.prepare("SELECT * FROM audit_events ORDER BY id");
        const rows: any[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free(); return rows;
      } finally { db.close(); }
    },
    close() { audit.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

for (const [name, makePlan, expected] of [
  ["wall", wall, ["get_selected_elements", "get_element_parameters", "set_element_parameters", "get_element_parameters"]],
  ["rename", () => plan("Omdøb de valgte typer efter denne navnestandard: [regel]."),
    ["get_selected_elements", "get_element_parameters", "batch_rename", "batch_rename", "get_element_parameters"]],
  ["schedule", () => plan("Opret en schedule for vægge med Type, Instance, bygningsdelsnummer og areal."),
    ["list_schedulable_fields", "create_schedule", "get_schedule_data"]],
] as const) test(`${name}: uses real reviewed handlers, ordered verification and persistent old/new audit`, async () => {
  const s = await setup();
  const calls: { name: string; args: any }[] = [];
  fixture.command = async (name, args) => { calls.push({ name, args }); return { success: true, value: calls.length < 3 ? 10 : 20 }; };
  try {
    const result = await s.orchestrator.run(makePlan(), runtime);
    assert.equal(result.status, "success", JSON.stringify(result));
    assert.equal(result.verified, true);
    assert.deepEqual(calls.map(c => c.name), expected);
    if (name === "rename") assert.deepEqual(calls.filter(c => c.name === "batch_rename").map(c => c.args.dryRun), [true, false]);
    if (name === "schedule") assert.equal(calls[1].args.type, "regular", "existing handler owns payload translation");
    const rows = await s.events();
    assert.equal(new Set(rows.filter(r => r.target_kind === "step").map(r => r.target_id)).size, expected.length);
    assert.ok(rows.some(r => r.old_value_json === "10" && r.new_value_json === "20" && r.verified === 1));
    assert.ok(rows.every(r => r.run_id === result.runId));
  } finally { s.close(); }
});

for (const failure of ["throw", "nested", "verify"] as const) test(`${failure}: stops and never claims partial success or invented rollback`, async () => {
  const s = await setup();
  let calls = 0;
  fixture.command = async name => {
    calls++;
    if (name === "set_element_parameters") {
      if (failure === "throw") throw new Error("read-only parameter");
      if (failure === "nested") return { success: true, results: [{ success: true }, { success: false, error: "parameter failed" }] };
    }
    return { success: true };
  };
  try {
    const result = await s.orchestrator.run(wall(), { ...runtime, assess: async c => failure !== "verify" || c.step.phase !== "verify" });
    assert.equal(result.status, "failure");
    assert.equal(result.verified, false);
    assert.equal(result.mutationState, "may_have_changes");
    assert.equal(calls, failure === "verify" ? 4 : 3);
    const rows = await s.events();
    assert.equal(rows.at(-1).outcome, "failure");
    assert.equal(rows.at(-1).verified, 0);
    assert.ok(!rows.some(r => r.outcome === "rolled_back"));
  } finally { s.close(); }
});

test("policy, unresolved bindings, missing evidence and schema validation fail before writes", async () => {
  const s = await setup();
  let writes = 0;
  fixture.command = async name => { if (name === "set_element_parameters") writes++; return { success: true }; };
  try {
    const invalid = wall(); invalid.steps[1].phase = "write";
    assert.equal((await s.orchestrator.run(invalid, runtime)).error?.stage, "policy");
    assert.equal((await s.orchestrator.run(wall(), { ...runtime, prepare: async () => ({ bindings: {} }) })).status, "failure");
    assert.equal((await s.orchestrator.run(wall(), { ...runtime, prepare: async c => ({ ...(await runtime.prepare(c)), changes: [] }) })).status, "failure");
    const executor = new ReviewedToolExecutor();
    await assert.rejects(executor.invoke("set_element_parameters", { requests: "bad" }));
    await assert.rejects(executor.invoke("send_code_to_revit", {}));
    await assert.rejects(executor.invoke("nbs_connect_project", {}));
    assert.equal(writes, 0);
  } finally { s.close(); }
});

test("audit failure fails closed before invocation and is explicit in error envelope", async () => {
  let calls = 0;
  const orchestrator = new WorkflowOrchestrator(rules, { async invoke() { calls++; } }, {
    async append() { throw new Error("disk full"); }, schemaVersion: () => 1, close() {},
  });
  const result = await orchestrator.run(wall(), runtime);
  assert.equal(result.status, "failure"); assert.equal(result.error?.code, "audit_failure");
  assert.equal(result.mutationState, "none"); assert.equal(calls, 0);
});

test("post-write audit failure is failure, does not retry the write or invoke read-back", async () => {
  const s = await setup();
  let calls = 0;
  fixture.command = async () => { calls++; return { success: true }; };
  const append = s.audit.append.bind(s.audit);
  s.audit.append = async event => {
    if (event.toolId === "set_element_parameters" && event.outcome === "success") throw new Error("disk full after write");
    await append(event);
  };
  try {
    const result = await s.orchestrator.run(wall(), runtime);
    assert.equal(result.error?.code, "audit_failure");
    assert.equal(result.status, "failure"); assert.equal(result.verified, false);
    assert.equal(calls, 3); assert.equal(result.mutationState, "may_have_changes");
    assert.equal((await s.events()).at(-1).outcome, "failure");
  } finally { s.close(); }
});

function nbsFixture(options: { drift?: boolean; modelDrift?: boolean; fail?: boolean; badCount?: boolean; unverified?: boolean; noOp?: boolean; unresolved?: boolean } = {}) {
  let snapshots = 0, writes = 0;
  fixture.mappings = [];
  fixture.request = async path => path.endsWith("/components") ? { components: [{ id: 20, name: "Wall", classificationcode: "L%AD", classificationserial: "001" }] }
    : path === "/projects" ? [{ id: 10 }] : { id: 10, classificationcode_separator: "" };
  fixture.command = async (name, args) => {
    assert.equal(name, "nbs_project");
    if (args.operation === "status") return { modelKey: options.modelDrift && snapshots > 0 ? "b" : "a", projectId: "10", missingParameters: [] };
    if (args.operation === "snapshot") {
      snapshots++;
      const existing = options.noOp ? "L%AD001" : "old";
      return { modelKey: options.modelDrift && snapshots > 1 ? "b" : "a", projectId: "10",
        types: [{ typeId: 1, uniqueId: "type-a", typeName: "Wall", familyName: "Wall", parameters: {
          "NBS Component Type Id": options.unresolved ? "999" : "20", "NBS Classificationcode": existing } }],
        instances: [{ id: 2, typeId: 1, uniqueId: "instance-a", parameters: {
          "NBS Component Instance Id": "20", "NBS Instance Classificationcode": options.drift && snapshots > 1 ? "changed" : existing } }],
      };
    }
    if (args.operation === "write_parameters") {
      writes++;
      if (options.fail) throw new Error("instance write failed; transaction rolled back");
      assert.deepEqual(args.requests.map((r: any) => r.value), ["L%AD001", "L%AD001"]);
      return { verified: !options.unverified, writtenParameters: options.badCount ? 1 : args.requests.length };
    }
    throw new Error("Unexpected operation");
  };
  return () => writes;
}

for (const variant of ["success", "drift", "modelDrift", "fail", "badCount", "unverified", "noOp", "unresolved"] as const)
  test(`NBS ${variant}: existing planner/write/verify with per-parameter audit, offline`, async () => {
    const s = await setup();
    const writes = nbsFixture({ [variant]: true });
    try {
      const result = await s.orchestrator.run(nbs(), runtime);
      const success = variant === "success" || variant === "noOp";
      assert.equal(result.status, success ? "success" : "failure", JSON.stringify(result));
      assert.equal(writes(), ["success", "fail", "badCount", "unverified"].includes(variant) ? 1 : 0);
      const rows = await s.events();
      if (variant === "success") {
        for (const scope of ["type_parameter", "instance_parameter"]) assert.ok(rows.some(r =>
          r.target_kind === scope && r.old_value_json === '"old"' && r.new_value_json === '"L%AD001"' && r.verified === 1));
        assert.equal(fixture.mappings.length, 1, "existing handler persists only verified mappings");
      }
      if (!success) assert.equal(rows.at(-1).outcome, "failure");
    } finally { s.close(); }
  });
