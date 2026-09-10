import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProductionWorkflowRuntime, heightInInternalFeet, type RuntimeRequest } from "../../src/agent/ProductionWorkflowRuntime.js";
import { WorkflowOrchestrator } from "../../src/agent/WorkflowOrchestrator.js";
import { ReviewedToolExecutor } from "../../src/agent/ReviewedToolExecutor.js";
import { RuleEngine } from "../../src/agent/RuleEngine.js";
import { IntentRouter } from "../../src/agent/IntentRouter.js";
import { ToolCatalog, ROUTING_TOOL_IDS } from "../../src/agent/ToolCatalog.js";
import { SqliteAuditSink } from "../../src/agent/audit/SqliteAuditSink.js";
import { fixture } from "./orchestrator-fixture.js";

const catalog = new ToolCatalog("runtime-test", ROUTING_TOOL_IDS);
const intents = {
  wall_height: "Ændr højden på de valgte vægge til 3200 mm.",
  rename_types: "Omdøb de valgte typer efter denne navnestandard: [regel].",
  create_schedule: "Opret en schedule for vægge med Type, Instance, bygningsdelsnummer og areal.",
  sync_classification: "Synkroniser bygningsdelsnummer L%AD001 fra NBS til de valgte Revit-elementer.",
};
const fields = [
  { parameterName: "Type", fieldType: "ElementType" },
  { parameterName: "Mark", fieldType: "Instance" },
  { parameterName: "NBS Instance Classificationcode", fieldType: "Instance" },
  { parameterName: "Area", fieldType: "Instance" },
] as const;
const requests: Record<keyof typeof intents, RuntimeRequest> = {
  wall_height: { intentKind: "wall_height", height: 3200, unit: "mm" },
  rename_types: { intentKind: "rename_types", prefix: "New ", acknowledgeTypeWideImpact: true },
  create_schedule: { intentKind: "create_schedule", name: "Wall specification", fields: fields.map(f => ({ ...f })) },
  sync_classification: { intentKind: "sync_classification", category: "OST_Walls", classificationKey: "L%AD001", projectId: "10" },
};
function param(name: string, value: unknown, storageType: string) {
  return { name, value, storageType, isReadOnly: false, isShared: false, hasValue: true };
}
function world() {
  const state = {
    modelKey: "model-a", selected: [{ Id: 1, UniqueId: "wall-a", Name: "Wall", Category: "Walls" }],
    types: [{ FamilyTypeId: 10, UniqueId: "type-a", FamilyName: "Basic Wall", TypeName: "Wall", Category: "Walls" },
      { FamilyTypeId: 11, UniqueId: "type-b", FamilyName: "Basic Wall", TypeName: "Other", Category: "Walls" }],
    params: [param("Type", 10, "ElementId"), param("Unconnected Height", 10, "Double"),
      param("Top Constraint", -1, "ElementId"), param("Top is Attached", 0, "Integer"), param("Base is Attached", 0, "Integer")],
    fields: fields.map((f, i) => ({ name: f.parameterName, fieldType: f.fieldType as string, parameterId: i + 1 })),
    schedules: [] as { id: number; name: string; category: string }[],
    headers: fields.map(f => f.parameterName) as string[],
    components: [{ id: 20, name: "NBS Wall", classificationcode: "L%AD", classificationserial: "001" }],
    separator: "" as string | undefined,
    typeCode: "old", instanceCode: "old", instanceLink: "20", extraInstance: false,
    writes: [] as { name: string; args: any }[], commands: [] as string[],
    corruptReadBack: false, truncate: false,
  };
  const envelope = (Response: any) => ({ Success: true, Response });
  fixture.request = async path => {
    if (path === "/projects") return [{ id: 10 }];
    if (path === "/projects/10") return { id: 10, classificationcode_separator: state.separator };
    if (path === "/projects/10/components") return { components: structuredClone(state.components) };
    throw new Error(`Unexpected NBS request ${path}`);
  };
  fixture.command = async (name, args) => {
    state.commands.push(name);
    if (name === "get_selected_elements") return structuredClone(state.selected);
    if (name === "get_available_family_types") return structuredClone(state.types);
    if (name === "get_element_parameters") return envelope(args.elementIds.map((elementId: number) => {
      const type = state.types.find(t => t.FamilyTypeId === elementId);
      return { elementId, elementName: type?.TypeName ?? "Wall", category: "Walls", ...(state.truncate ? { _truncated: true } : {}),
        parameters: structuredClone(type ? [param("Type Name", type.TypeName, "String")] : state.params) };
    }));
    if (name === "set_element_parameters") {
      state.writes.push({ name, args });
      if (!state.corruptReadBack) for (const r of args.requests) state.params.find(p => p.name === r.parameterName)!.value = r.value;
      return envelope(args.requests.map((r: any) => ({ elementId: r.elementId, parameterName: r.parameterName, success: true })));
    }
    if (name === "batch_rename") {
      const renames = args.elementIds.map((id: number) => {
        const type = state.types.find(t => t.FamilyTypeId === id)!;
        const oldName = type.TypeName;
        const newName = args.prefix + (args.findText ? oldName.split(args.findText).join(args.replaceText) : oldName) + args.suffix;
        if (!args.dryRun && !state.corruptReadBack) type.TypeName = newName;
        return { id, oldName, newName, success: true };
      });
      if (!args.dryRun) state.writes.push({ name, args });
      return envelope({ dryRun: args.dryRun, totalProcessed: renames.length, successCount: renames.length, renames });
    }
    if (name === "list_schedulable_fields") return envelope({ category: "OST_Walls", scheduleType: "regular", fieldCount: state.fields.length, fields: state.fields });
    if (name === "create_schedule") {
      state.writes.push({ name, args }); state.schedules.push({ id: 50, name: args.name, category: "Walls" });
      return envelope({ scheduleId: 50, name: args.name });
    }
    if (name === "get_schedule_data") return envelope(args.scheduleId ? {
      scheduleName: state.schedules[0].name, columnHeaders: state.corruptReadBack ? ["Wrong"] : state.headers,
      fieldCount: state.headers.length, rows: [], rowCount: 0, returnedRows: 0, availableFields: state.fields,
    } : { scheduleCount: state.schedules.length, schedules: state.schedules });
    if (name === "nbs_project") {
      if (args.operation === "status") return { modelKey: state.modelKey, projectId: "10", missingParameters: [], isReadOnly: false };
      if (args.operation === "snapshot") return { modelKey: state.modelKey, projectId: "10",
        types: [{ typeId: 10, uniqueId: "type-a", typeName: "Wall", familyName: "Basic Wall", parameters: {
          "NBS Component Type Id": "20", "NBS Classificationcode": state.typeCode } }],
        instances: [{ id: 1, typeId: 10, uniqueId: "wall-a", parameters: { "NBS Component Instance Id": state.instanceLink,
          "NBS Instance Classificationcode": state.instanceCode } }, ...(state.extraInstance ? [{ id: 2, typeId: 10, uniqueId: "wall-b", parameters: {} }] : [])] };
      if (args.operation === "write_parameters") {
        state.writes.push({ name, args });
        if (!state.corruptReadBack) { state.typeCode = "L%AD001"; state.instanceCode = "L%AD001"; }
        return { verified: true, writtenParameters: args.requests.length };
      }
    }
    throw new Error(`Unexpected command ${name}`);
  };
  return state;
}
async function run(request: RuntimeRequest) {
  const runtime = new ProductionWorkflowRuntime(request);
  const route = new IntentRouter(catalog).route(intents[request.intentKind]);
  assert.equal(route.status, "planned");
  if (route.status !== "planned") throw new Error("Bad fixture");
  const dir = mkdtempSync(join(tmpdir(), "runtime-test-"));
  const audit = await SqliteAuditSink.open({ filePath: join(dir, "audit-log.db") });
  try { return await new WorkflowOrchestrator(new RuleEngine(catalog), new ReviewedToolExecutor(), audit).run(route.plan, runtime); }
  finally { audit.close(); rmSync(dir, { recursive: true, force: true }); }
}
for (const kind of Object.keys(intents) as (keyof typeof intents)[]) {
  test(`${kind}: real runtime + reviewed handlers, bindings and read-back succeed offline`, async () => {
    const state = world();
    const result = await run(requests[kind]);
    assert.equal(result.status, "success", JSON.stringify(result)); assert.equal(result.verified, true);
    assert.equal(state.writes.length, 1);
    if (kind === "wall_height") assert.ok(Math.abs(state.writes[0].args.requests[0].value - 3200 / 304.8) < 1e-10);
    if (kind === "rename_types") assert.deepEqual(state.writes[0].args.elementIds, [10]);
    if (kind === "create_schedule") assert.deepEqual(state.writes[0].args.fields.map((f: any) => f.parameterName), fields.map(f => f.parameterName));
    if (kind === "sync_classification") assert.deepEqual(state.writes[0].args.requests.map((r: any) => r.value), ["L%AD001", "L%AD001"]);
  });
  test(`${kind}: a lying success response does not pass semantic read-back`, async () => {
    const state = world(); state.corruptReadBack = true;
    const result = await run(requests[kind]);
    assert.equal(result.status, "failure"); assert.equal(result.verified, false); assert.equal(state.writes.length, 1);
  });
}
test("explicit supported units convert to feet; unknown/display-unit guesses rejected before reads", () => {
  for (const [value, unit] of [[304.8, "mm"], [30.48, "cm"], [0.3048, "m"], [1, "ft"], [12, "in"]] as const)
    assert.ok(Math.abs(heightInInternalFeet(value, unit) - 1) < 1e-12);
  for (const [value, unit] of [[1, "project"], [NaN, "mm"], [-1, "mm"], [Infinity, "m"]] as const)
    assert.throws(() => heightInInternalFeet(value, unit));
  assert.throws(() => new ProductionWorkflowRuntime({ intentKind: "wall_height", height: 3200, unit: "unknown" } as any));
});
const badCases: [string, keyof typeof intents, (state: ReturnType<typeof world>) => void][] = [
  ["empty selection", "wall_height", s => { s.selected = []; }],
  ["duplicate selection", "wall_height", s => { s.selected.push(s.selected[0]); }],
  ["ambiguous/truncated selection", "wall_height", s => { s.selected = Array.from({ length: 100 }, (_, i) => ({ ...s.selected[0], Id: i + 1, UniqueId: `e${i}` })); }],
  ["unknown category/locale", "wall_height", s => { s.selected[0].Category = "Doors"; }],
  ["read-only height", "wall_height", s => { s.params[1].isReadOnly = true; }],
  ["wrong storage type", "wall_height", s => { s.params[1].storageType = "String"; }],
  ["shared parameter impersonates built-in", "wall_height", s => { s.params[1].isShared = true; }],
  ["constrained wall", "wall_height", s => { s.params[2].value = 100; }],
  ["attached wall", "wall_height", s => { s.params[3].value = 1; }],
  ["truncated parameter metadata", "wall_height", s => { s.truncate = true; }],
  ["duplicate parameter name", "wall_height", s => { s.params.push({ ...s.params[1] }); }],
  ["existing sibling name collision", "rename_types", s => { s.types[1].TypeName = "New Wall"; }],
  ["ambiguous Type parameter", "rename_types", s => { s.params.push({ ...s.params[0] }); }],
  ["incomplete family catalog", "rename_types", s => { s.types = Array.from({ length: 100 }, (_, i) => ({ ...s.types[0], FamilyTypeId: i + 10 })); }],
  ["missing schedule field", "create_schedule", s => { s.fields.pop(); }],
  ["wrong field scope", "create_schedule", s => { s.fields[0].fieldType = "Instance"; }],
  ["same-name type/instance ambiguity", "create_schedule", s => { s.fields.push({ ...s.fields[0], fieldType: "Instance" }); }],
  ["duplicate schedule name", "create_schedule", s => { s.schedules.push({ id: 3, name: "Wall specification", category: "Walls" }); }],
  ["unknown NBS key", "sync_classification", s => { s.components[0].classificationserial = "002"; }],
  ["ambiguous NBS key", "sync_classification", s => { s.components.push({ ...s.components[0], id: 21 }); }],
  ["unknown NBS separator", "sync_classification", s => { s.separator = undefined; }],
  ["category scope expansion", "sync_classification", s => { s.extraInstance = true; }],
  ["independent instance link mismatch", "sync_classification", s => { s.instanceLink = "21"; s.components.push({ ...s.components[0], id: 21, classificationserial: "002" }); }],
];
for (const [name, kind, mutate] of badCases) test(`${name}: fails before any write`, async () => {
  const state = world(); mutate(state);
  const result = await run(requests[kind]);
  assert.equal(result.status, "failure", JSON.stringify(result)); assert.equal(state.writes.length, 0);
});
test("model switch during validation is rejected before write", async () => {
  const state = world(); const original = fixture.command;
  fixture.command = async (name, args) => {
    const result = await original(name, args);
    if (name === "get_element_parameters") state.modelKey = "model-b";
    return result;
  };
  assert.equal((await run(requests.wall_height)).status, "failure"); assert.equal(state.writes.length, 0);
});
test("selected type is renamed directly and type-wide acknowledgement is required", async () => {
  const state = world(); state.selected = [{ Id: 10, UniqueId: "type-a", Name: "Wall", Category: "Walls" }];
  assert.equal((await run(requests.rename_types)).status, "success");
  assert.throws(() => new ProductionWorkflowRuntime({ intentKind: "rename_types", prefix: "New " } as any));
});

test("type assignment changing after rename preview cannot redirect the write", async () => {
  const state = world(); const original = fixture.command;
  fixture.command = async (name, args) => {
    const result = await original(name, args);
    if (name === "batch_rename" && args.dryRun) state.params[0].value = 11;
    return result;
  };
  assert.equal((await run(requests.rename_types)).status, "failure"); assert.equal(state.writes.length, 0);
});
test("new name collision after rename preview is rechecked before write", async () => {
  const state = world(); const original = fixture.command;
  fixture.command = async (name, args) => {
    const result = await original(name, args);
    if (name === "batch_rename" && args.dryRun) state.types[1].TypeName = "New Wall";
    return result;
  };
  assert.equal((await run(requests.rename_types)).status, "failure"); assert.equal(state.writes.length, 0);
});
test("invalid and many-to-one rename requests do not write", async () => {
  let state = world();
  assert.equal((await run({ intentKind: "rename_types", prefix: "bad:", acknowledgeTypeWideImpact: true })).status, "failure");
  assert.equal(state.writes.length, 0);
  state = world();
  state.types[0].TypeName = "A"; state.types[1].TypeName = "AA";
  state.selected = state.types.map(t => ({ Id: t.FamilyTypeId, UniqueId: t.UniqueId, Name: t.TypeName, Category: t.Category }));
  const result = await run({ intentKind: "rename_types", prefix: "N", findText: "A", replaceText: "", acknowledgeTypeWideImpact: true });
  assert.equal(result.status, "failure"); assert.equal(state.writes.length, 0);
});
test("schedule names are resolved with canonical live field casing", async () => {
  world();
  const result = await run({ intentKind: "create_schedule", name: "Wall specification",
    fields: fields.map(f => ({ ...f, parameterName: f.parameterName.toLowerCase() })) });
  assert.equal(result.status, "success", JSON.stringify(result));
});
test("NBS already-current dual values pass a separate read-back without a write", async () => {
  const state = world(); state.typeCode = state.instanceCode = "L%AD001";
  const result = await run(requests.sync_classification);
  assert.equal(result.status, "success", JSON.stringify(result)); assert.equal(state.writes.length, 0);
});
test("NBS type success plus instance mismatch is full workflow failure", async () => {
  const state = world(); const original = fixture.command;
  fixture.command = async (name, args) => {
    const result = await original(name, args);
    if (name === "nbs_project" && args.operation === "write_parameters") state.instanceCode = "L%AD002";
    return result;
  };
  assert.equal((await run(requests.sync_classification)).status, "failure"); assert.equal(state.writes.length, 1);
});
