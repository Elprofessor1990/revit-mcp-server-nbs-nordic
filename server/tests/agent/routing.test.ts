import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeIntent } from "../../src/agent/IntentNormalizer.js";
import { IntentRouter } from "../../src/agent/IntentRouter.js";
import { RuleEngine } from "../../src/agent/RuleEngine.js";
import { ToolCatalog, ROUTING_TOOL_IDS } from "../../src/agent/ToolCatalog.js";
import type { WorkflowPlan } from "../../src/agent/types.js";

const catalog = new ToolCatalog("fixture-v1", ROUTING_TOOL_IDS);
const router = new IntentRouter(catalog);
const cases = [
  ["Ændr højden på de valgte vægge til 3200 mm.", "Change the height of the selected walls to 3200 mm.", "wall_height",
    ["get_selected_elements", "get_element_parameters", "set_element_parameters", "get_element_parameters"]],
  ["Opret en schedule for vægge med Type, Instance, bygningsdelsnummer og areal.", "Create a wall schedule with Type, Instance, classification code and area.", "create_schedule",
    ["list_schedulable_fields", "create_schedule", "get_schedule_data"]],
  ["Omdøb de valgte typer efter denne navnestandard: [regel].", "Rename the selected types using this naming standard: [regel].", "rename_types",
    ["get_selected_elements", "get_element_parameters", "batch_rename", "batch_rename", "get_element_parameters"]],
  ["Synkroniser bygningsdelsnummer L%AD001 fra NBS til de valgte Revit-elementer.", "Sync classification code L%AD001 from NBS to the selected Revit elements.", "sync_classification",
    ["get_connection_status", "sync_revit_types_to_nbs", "sync_revit_types_to_nbs"]],
] as const;

function getPlan(input = cases[0][0]): WorkflowPlan {
  const result = router.route(input);
  assert.equal(result.status, "planned");
  if (result.status !== "planned") throw new Error(result.reason);
  assert.equal(result.executable, false);
  return result.plan;
}

for (const [danish, english, kind, tools] of cases) {
  test(`${kind}: Danish/English normalize identically and route to reviewed tools`, () => {
    assert.deepEqual(normalizeIntent(danish), normalizeIntent(english));
    const result = router.route(danish);
    assert.equal(result.status, "planned");
    if (result.status !== "planned") return;
    assert.equal(result.source, "deterministic");
    assert.equal(result.plan.intentKind, kind);
    assert.deepEqual(result.plan.steps.map(step => step.toolId), [...tools]);
    assert.equal(result.plan.requiresConfirmation, true);
    assert.ok(result.executionObligations.includes("log_all_writes"));
    assert.equal(result.executable, false);
  });
}

test("routing subset exists in the frozen real MCP inventory", () => {
  const snapshot = JSON.parse(readFileSync("tests/fixtures/tool-contract.snapshot.json", "utf8"));
  const names = new Set(snapshot.tools.map((tool: { name: string }) => tool.name));
  for (const id of ROUTING_TOOL_IDS) assert.ok(names.has(id), id);
});

test("unknown, compound and custom-code requests give explicit discovery fallback", () => {
  for (const input of ["Make a roof", "send_code_to_revit", cases[0][0] + " Delete the model.", "Ændr højden på de valgte vægge til 0 mm."]) {
    assert.deepEqual(router.route(input), { status: "fallback", reason: "unknown_intent", discovery: "normal_mcp_discovery_and_explicit_planning" });
  }
});

test("every candidate passes catalog and allow-list, and custom code is always denied", () => {
  assert.equal(new IntentRouter(catalog, []).route(cases[0][0]).status, "fallback");
  assert.equal(new IntentRouter(new ToolCatalog("empty", [])).route(cases[0][0]).status, "fallback");
  const plan = getPlan();
  plan.steps[0].toolId = "send_code_to_revit";
  const permissive = new RuleEngine(new ToolCatalog("fixture-v1", [...ROUTING_TOOL_IDS, "send_code_to_revit"]), [...ROUTING_TOOL_IDS, "send_code_to_revit"]);
  assert.equal(permissive.evaluate(plan).code, "unsafe_tool");
});

test("rules reject stale contracts, excessive steps, missing validation/verification and phase spoofing", () => {
  const rules = new RuleEngine(catalog);
  const mutations: ((plan: WorkflowPlan) => void)[] = [
    p => { p.catalogFingerprint = "old"; }, p => { p.schemaVersion = 2; },
    p => { p.steps = Array(21).fill(p.steps[0]); },
    p => { p.steps.splice(1, 1); }, p => { p.steps.pop(); },
    p => { p.steps[2].phase = "read"; }, p => { p.requiresConfirmation = false; },
    p => { p.steps[2].argsTemplate = { requests: [{ elementId: 123, value: "secret" }] }; },
  ];
  for (const mutate of mutations) { const p = getPlan(); mutate(p); assert.equal(rules.evaluate(p).allowed, false); }
});

test("NBS uses one atomic write with dual classification and matching preview", () => {
  const result = router.route(cases[3][0]);
  assert.equal(result.status, "planned");
  if (result.status !== "planned") return;
  const writes = result.plan.steps.filter(step => step.phase === "write");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].toolId, "sync_revit_types_to_nbs");
  assert.equal(writes[0].argsTemplate.linkMode, "typeAndInstance");
  assert.deepEqual(writes[0].argsTemplate.fields, ["classificationcode"]);
  assert.equal(result.plan.steps[1].argsTemplate.dryRun, true);
  assert.equal(writes[0].argsTemplate.dryRun, false);
  assert.ok(result.executionObligations.includes("same_model_and_project_at_preview_and_write"));
  assert.ok(result.executionObligations.includes("reject_selection_scope_expansion"));
  for (const change of [{ linkMode: "typeOnly" }, { fields: ["name"] }, { parameterName: "NBS Override" }]) {
    const altered = structuredClone(result.plan);
    Object.assign(altered.steps[2].argsTemplate, change);
    assert.equal(new RuleEngine(catalog).evaluate(altered).allowed, false);
  }
});

test("live user values stay outside reusable templates", () => {
  const result = router.route(cases[0][0]);
  assert.equal(result.status, "planned");
  if (result.status !== "planned") return;
  assert.equal(result.bindings.heightMm, 3200);
  assert.ok(!JSON.stringify(result.plan).includes("3200"));
  const modified = result.plan;
  modified.steps.length = 0;
  assert.equal(getPlan().steps.length, 4);
});
