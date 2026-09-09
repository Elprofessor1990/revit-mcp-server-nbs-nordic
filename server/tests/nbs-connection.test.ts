import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { buildSyncPlan, fullClassification, parseNbsDate, formatNbsDate, type SyncSnapshot } from "../src/integrations/nbs/matching/SyncPlanner.js";
import { matchType } from "../src/integrations/nbs/matching/TypeMatcher.js";
import { connectProject, cloneProject, resolveNbsProjectId, validateProjectId } from "../src/integrations/nbs/ProjectConnection.js";
import { nbsClient } from "../src/integrations/nbs/NbsClient.js";
import { createComponent } from "../src/integrations/nbs/components/ComponentService.js";
import { pushSheet } from "../src/integrations/nbs/sheets/SheetService.js";
import { pushQuantities } from "../src/integrations/nbs/quantities/QuantityService.js";
import { readModelSettings, NBS_SYNC_FIELDS, decodeNativeLinkType, resolveLinkMode } from "../src/integrations/nbs/ModelSettings.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NbsProject, NbsComponent } from "../src/integrations/nbs/NbsTypes.js";

const project: NbsProject = { id: 10, project_name: "Test", project_id: "P1", plan: "free", classificationcode_separator: "." };
const component: NbsComponent = { id: 20, name: "Facade", classificationcode: "[L]%AD", classificationserial: "001", updated_at: "2026-09-09 10:00:00", published_document_urls: ["https://nbsnordic.net/pubdocs/view/example"] };
function snapshot(): SyncSnapshot {
  return { modelKey: "model-a", projectId: "10", types: [{ typeId: 1, uniqueId: "type-a", typeName: "Wall", familyName: "Basic Wall", parameters: { "NBS Component Type Id": "20" } }],
    instances: [{ id: 2, typeId: 1, uniqueId: "wall-a", parameters: {} }, { id: 3, typeId: 1, uniqueId: "wall-b", parameters: {} }] };
}

test("full code preserves serial zeros and the project's configured separator", () => {
  assert.equal(fullClassification(component, project), "[L]%AD.001");
  assert.equal(fullClassification(component, { classificationcode_separator: "" }), "[L]%AD001");
  assert.equal(fullClassification({ ...component, classificationcode_separator: "-" }, project), "[L]%AD-001");
  assert.throws(() => fullClassification(component, {}), /separator/);
});

test("already linked types and newly placed instances get all supported NBS fields", () => {
  const plan = buildSyncPlan(snapshot(), [component], project, undefined, { inheritTypeForUnlinkedInstances: true });
  assert.deepEqual(plan.updatedTypes, [1]);
  assert.deepEqual(plan.updatedInstances, [2, 3]);
  for (const uniqueId of ["type-a", "wall-a", "wall-b"])
    assert.ok(plan.requests.some(r => r.uniqueId === uniqueId && r.value === "[L]%AD.001"));
  assert.ok(plan.requests.some(r => r.parameterName === "NBS Instance Doc Link" && r.value.startsWith("https://nbsnordic.net/")));
  assert.ok(plan.requests.every(r => r.parameterName !== "Mark"));
});

// Live 2026-09-09: the official addin's Sync Now writes its own sync timestamp
// ("2026-09-09 10:57:48", local) into "NBS Date"; writing the component's ISO
// updated_at back made the two tools rewrite the field in turns.
test("NBS Date follows the addin's format and is never downgraded to an older NBS change", () => {
  assert.equal(formatNbsDate(parseNbsDate("2026-09-09 10:00:00")!), "2026-09-09 10:00:00");
  assert.equal(parseNbsDate("2026-09-09T02:38:14.000000Z"), Date.UTC(2026, 8, 9, 2, 38, 14));
  assert.equal(parseNbsDate("09/09/2026 02:38:14"), undefined);
  assert.equal(parseNbsDate(""), undefined);

  const changed = (state: SyncSnapshot, previous?: string) => {
    state.types[0].parameters["NBS Date"] = previous ?? null;
    return buildSyncPlan(state, [component], project, undefined, { linkMode: "typeOnly", fields: ["date"] }).requests;
  };
  assert.deepEqual(changed(snapshot()).map(r => r.value), ["2026-09-09 10:00:00"], "empty field is written in the addin's format");
  assert.equal(changed(snapshot(), "2026-09-09 10:57:48").length, 0, "the addin's newer sync stamp is left alone");
  assert.equal(changed(snapshot(), "2026-09-09 10:00:00").length, 0, "same instant is current");
  assert.deepEqual(changed(snapshot(), "2026-09-08 10:00:00").map(r => r.previousValue), ["2026-09-08 10:00:00"], "an older stamp is refreshed");
  assert.equal(changed(snapshot(), "09/09/2026 02:38:14").length, 1, "an unparseable value is replaced");
  const iso = buildSyncPlan(snapshot(), [{ ...component, updated_at: "2026-09-09T02:38:14.000000Z" }], project, undefined, { linkMode: "typeOnly", fields: ["date"] }).requests[0].value;
  assert.equal(iso, formatNbsDate(Date.UTC(2026, 8, 9, 2, 38, 14)), "API ISO/UTC is written as local addin time");
});

test("a repeated sync is a no-op, while changed NBS data refreshes linked elements", () => {
  const state = snapshot();
  const first = buildSyncPlan(state, [component], project, undefined, { inheritTypeForUnlinkedInstances: true });
  for (const r of first.requests) {
    const element = [...state.types, ...state.instances].find(e => e.uniqueId === r.uniqueId)!;
    element.parameters[r.parameterName] = r.value;
  }
  assert.equal(buildSyncPlan(state, [component], project).requests.length, 0);
  const changed = buildSyncPlan(state, [{ ...component, classificationserial: "002" }], project);
  assert.equal(changed.requests.length, 3);
  assert.ok(changed.requests.every(r => r.value === "[L]%AD.002" && r.previousValue === "[L]%AD.001"));
});

test("model/project mismatch and duplicate code matches never produce writes", () => {
  assert.throws(() => buildSyncPlan({ ...snapshot(), projectId: "11" }, [component], project), /requested NBS project/);
  const state = snapshot();
  state.types[0].parameters = { "NBS Classificationcode": "[L]%AD.001" };
  const plan = buildSyncPlan(state, [component, { ...component, id: 21 }], project);
  assert.equal(plan.requests.length, 0);
  assert.equal(plan.rows[0].match.ambiguous, true);
});

test("different serials disambiguate components in the same code group", () => {
  const state = snapshot();
  state.types[0].parameters = { "NBS Classificationcode": "[L]%AD.002" };
  const plan = buildSyncPlan(state, [component, { ...component, id: 21, classificationserial: "002" }], project);
  assert.equal(plan.rows[0].match.component?.id, 21);
});

test("name matches are proposals; explicit user mapping resolves unlinked ambiguity", () => {
  const state = snapshot();
  state.types[0].parameters = {};
  state.types[0].typeName = "Facade";
  assert.equal(buildSyncPlan(state, [component], project).requests.length, 0);
  assert.ok(buildSyncPlan(state, [component], project, { "1": 20 }).requests.length > 0);
});

test("a deleted or foreign component id is not silently rematched by name", () => {
  const result = matchType({ typeId: 1, familyName: "Wall", typeName: "Facade", existingNbsComponentId: "999" }, [{ id: 20, name: "Facade" }]);
  assert.equal(result.ambiguous, true);
  assert.equal(result.component, undefined);
});

test("unknown and unsafe document URLs are not fabricated or copied", () => {
  const without = buildSyncPlan(snapshot(), [{ ...component, published_document_urls: undefined }], project);
  assert.equal(without.requests.filter(r => r.parameterName.endsWith("Doc Link")).length, 0);
  const unsafe = buildSyncPlan(snapshot(), [{ ...component, published_document_urls: ["javascript:alert(1)", "https://elsewhere.example/"] }], project);
  assert.equal(unsafe.requests.filter(r => r.parameterName.endsWith("Doc Link")).length, 0);
});

test("numeric database ids are validated, rather than interpolating arbitrary paths", () => {
  assert.equal(validateProjectId(10), "10");
  for (const id of ["P1", "../projects", "", "0", -1]) assert.throws(() => validateProjectId(id));
});

test("Type Only never writes instance fields, even with existing different instance links", () => {
  const state = snapshot();
  state.instances[0].parameters["NBS Component Instance Id"] = "21";
  const plan = buildSyncPlan(state, [component, { ...component, id: 21, classificationserial: "002" }], project, undefined, { linkMode: "typeOnly" });
  assert.deepEqual(plan.updatedTypes, [1]);
  assert.deepEqual(plan.updatedInstances, []);
  assert.ok(plan.requests.every(r => r.uniqueId === "type-a"));
});

test("Instance Only supports different component links within the same Revit type", () => {
  const state = snapshot();
  const plan = buildSyncPlan(state, [component, { ...component, id: 21, classificationserial: "002" }], project, undefined,
    { linkMode: "instanceOnly", explicitInstanceMapping: { "wall-a": 20, "wall-b": 21 } });
  assert.deepEqual(plan.updatedTypes, []);
  assert.deepEqual(plan.updatedInstances, [2, 3]);
  assert.ok(plan.requests.some(r => r.uniqueId === "wall-a" && r.value === "[L]%AD.001"));
  assert.ok(plan.requests.some(r => r.uniqueId === "wall-b" && r.value === "[L]%AD.002"));
  assert.ok(plan.requests.every(r => r.uniqueId !== "type-a"));
  for (const r of plan.requests) state.instances.find(i => i.uniqueId === r.uniqueId)!.parameters[r.parameterName] = r.value;
  assert.equal(buildSyncPlan(state, [component, { ...component, id: 21, classificationserial: "002" }], project, undefined, { linkMode: "instanceOnly" }).requests.length, 0);
});

test("Type and Instance preserves independent instance links instead of overwriting from the type", () => {
  const state = snapshot();
  state.instances[0].parameters["NBS Component Instance Id"] = "21";
  const plan = buildSyncPlan(state, [component, { ...component, id: 21, classificationserial: "002" }], project, undefined,
    { linkMode: "typeAndInstance", inheritTypeForUnlinkedInstances: true });
  assert.ok(plan.requests.some(r => r.uniqueId === "type-a" && r.value === "[L]%AD.001"));
  assert.ok(plan.requests.some(r => r.uniqueId === "wall-a" && r.value === "[L]%AD.002"));
  assert.ok(plan.requests.some(r => r.uniqueId === "wall-b" && r.value === "[L]%AD.001"));
  assert.equal(plan.instanceRows[0].inheritedFromType, false);
  assert.equal(plan.instanceRows[1].inheritedFromType, true);
});

test("unlinked instances do not inherit a type link unless explicitly requested", () => {
  for (const linkMode of ["instanceOnly", "typeAndInstance"] as const) {
    const plan = buildSyncPlan(snapshot(), [component], project, undefined, { linkMode });
    assert.deepEqual(plan.updatedInstances, []);
    assert.equal(plan.instanceRows.length, 2);
  }
});

test("stale instance IDs are not replaced by type inheritance", () => {
  const state = snapshot();
  state.instances[0].parameters["NBS Component Instance Id"] = "999";
  const plan = buildSyncPlan(state, [component], project, undefined, { inheritTypeForUnlinkedInstances: true });
  assert.equal(plan.instanceRows[0].match.ambiguous, true);
  assert.ok(plan.requests.every(r => r.uniqueId !== "wall-a"));
});

test("unknown targets and incompatible link-mode mappings fail before any write", () => {
  const state = snapshot();
  assert.throws(() => buildSyncPlan(state, [component], project, undefined, { explicitInstanceMapping: { unknown: 20 } }), /unknown instance/);
  assert.throws(() => buildSyncPlan(state, [component], project, undefined, { explicitInstanceMapping: { "wall-a": 999 } }), /unknown NBS/);
  assert.throws(() => buildSyncPlan(state, [component], project, { "1": 20 }, { linkMode: "instanceOnly" }), /Type mappings/);
  assert.throws(() => buildSyncPlan(state, [component], project, undefined, { linkMode: "typeOnly", explicitInstanceMapping: { "wall-a": 20 } }), /Instance mappings/);
  assert.throws(() => buildSyncPlan(state, [component], project, undefined, { linkMode: "instanceOnly", inheritTypeForUnlinkedInstances: true }), /inheritance/);
});

test("conflicting explicit instance remapping is rejected, not silently ignored", () => {
  const state = snapshot();
  state.instances[0].parameters["NBS Component Instance Id"] = "21";
  assert.throws(() => buildSyncPlan(state, [component, { ...component, id: 21 }], project, undefined,
    { linkMode: "instanceOnly", explicitInstanceMapping: { "wall-a": 20 } }), /different NBS component/);
});

test("50 instances of one type can keep 50 distinct codes returned by NBS", () => {
  const state = snapshot();
  state.instances = Array.from({ length: 50 }, (_, i) => ({ id: 1000 + i, typeId: 1, uniqueId: `wall-${i}`, parameters: {} }));
  const components = Array.from({ length: 50 }, (_, i) => ({ ...component, id: 2000 + i, classificationserial: String(i + 1).padStart(3, "0") }));
  const mapping = Object.fromEntries(state.instances.map((instance, i) => [instance.uniqueId, components[i].id]));
  const plan = buildSyncPlan(state, components, project, undefined, { linkMode: "instanceOnly", explicitInstanceMapping: mapping });
  const codes = plan.requests.filter(r => r.parameterName === "NBS Instance Classificationcode").map(r => r.value);
  assert.equal(new Set(codes).size, 50);
  assert.ok(codes.includes("[L]%AD.001") && codes.includes("[L]%AD.050"));
  assert.equal(plan.updatedTypes.length, 0);
  assert.equal(plan.updatedInstances.length, 50);
  assert.throws(() => buildSyncPlan(state, components.slice(0, 49), project, undefined,
    { linkMode: "instanceOnly", explicitInstanceMapping: mapping }), /unknown NBS component/);
});

test("project connection checks API access, guards model identity, and does not change the global default", async () => {
  let currentModel = "model-a";
  let linked: string | null = null;
  const commands: any[] = [];
  const server = net.createServer(socket => {
    let buffer = "";
    socket.on("data", chunk => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const request = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        commands.push(request.params);
        if (request.params.operation === "connect") {
          if (request.params.expectedModelKey !== currentModel) {
            socket.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: "active model changed" } }) + "\n");
            continue;
          }
          linked = request.params.projectId;
        }
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { modelKey: currentModel, documentTitle: "Fixture", filePath: "fixture.rvt", projectId: linked, missingParameters: [], parameterFileAvailable: true, isReadOnly: false } }) + "\n");
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, resolve));
  const oldPort = process.env.REVIT_MCP_PORT;
  const oldDefault = process.env.NBS_PROJECT_ID;
  const originalRequest = nbsClient.request;
  process.env.REVIT_MCP_PORT = String((server.address() as net.AddressInfo).port);
  process.env.NBS_PROJECT_ID = "999";
  try {
    await assert.rejects(resolveNbsProjectId(), /not connected/);
    nbsClient.request = async () => project as any;
    const result = await connectProject(10, "model-a");
    assert.equal(result.projectId, "10");
    assert.equal(await resolveNbsProjectId(), "10");
    assert.equal(process.env.NBS_PROJECT_ID, "999");
    assert.equal(commands.filter(c => c.operation === "connect").length, 1);

    nbsClient.request = async () => { throw new Error("NBS 401"); };
    await assert.rejects(connectProject(11), /401/);
    assert.equal(commands.filter(c => c.operation === "connect").length, 1);

    nbsClient.request = async () => { currentModel = "model-b"; return project as any; };
    await assert.rejects(connectProject(10, "model-a"), /active model changed/);
  } finally {
    nbsClient.request = originalRequest;
    if (oldPort === undefined) delete process.env.REVIT_MCP_PORT; else process.env.REVIT_MCP_PORT = oldPort;
    if (oldDefault === undefined) delete process.env.NBS_PROJECT_ID; else process.env.NBS_PROJECT_ID = oldDefault;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("field selection limits which NBS parameters are written, and never silently drops to none", () => {
  const all = buildSyncPlan(snapshot(), [component], project, undefined, { inheritTypeForUnlinkedInstances: true });
  assert.deepEqual(all.fields, [...NBS_SYNC_FIELDS]);
  const only = buildSyncPlan(snapshot(), [component], project, undefined, { inheritTypeForUnlinkedInstances: true, fields: ["classificationcode", "name"] });
  assert.deepEqual(only.fields, ["classificationcode", "name"]);
  const names = new Set(only.requests.map(r => r.parameterName));
  assert.deepEqual([...names].sort(), ["NBS Classificationcode", "NBS Component Name", "NBS Instance Classificationcode", "NBS Instance Component Name"]);
  assert.ok(only.requests.every(r => !r.parameterName.includes(" Id") && !r.parameterName.includes("Date") && !r.parameterName.includes("Doc Link")));
  assert.throws(() => buildSyncPlan(snapshot(), [component], project, undefined, { fields: [] }), /At least one/);
  assert.throws(() => buildSyncPlan(snapshot(), [component], project, undefined, { fields: ["mark" as any] }), /Unknown NBS sync field/);
});

test("per-model sync defaults are read from the shared settings file and malformed values are ignored, not guessed", () => {
  const dir = mkdtempSync(join(tmpdir(), "nbs-settings-"));
  const file = join(dir, "nbs-config.json");
  try {
    assert.deepEqual(readModelSettings("model-a", file), {});
    writeFileSync(file, JSON.stringify({ apiKey: "secret", models: {
      "model-a": { linkMode: "instanceOnly", fields: ["id", "classificationcode"] },
      "model-b": { linkMode: "everything", fields: ["id", "mark"] },
    } }));
    assert.deepEqual(readModelSettings("model-a", file), { linkMode: "instanceOnly", fields: ["id", "classificationcode"] });
    assert.deepEqual(readModelSettings("model-b", file), {});
    assert.deepEqual(readModelSettings("model-c", file), {});
    writeFileSync(file, "{ not json");
    assert.deepEqual(readModelSettings("model-a", file), {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Live verification 2026-09-09 (addin 1.6.0, Revit 2027): the Revit journal logged
// cB_LinkType.SelectItem(0, Type and Instance) → NBSLinkType=0 and
// SelectItem(1, Type Only) → NBSLinkType=1 in "NBS Override"; index 2 is the
// remaining list entry. Unknown codes must never be guessed into a mode.
test("the official addin's NBSLinkType code is decoded by the verified mapping and used only after explicit and saved choices", () => {
  assert.equal(decodeNativeLinkType("0"), "typeAndInstance");
  assert.equal(decodeNativeLinkType("1"), "typeOnly");
  assert.equal(decodeNativeLinkType(" 2 "), "instanceOnly");
  for (const code of ["3", "", "typeOnly", null, undefined]) assert.equal(decodeNativeLinkType(code), undefined);

  assert.deepEqual(resolveLinkMode("instanceOnly", { linkMode: "typeOnly" }, "0"), { linkMode: "instanceOnly", source: "call" });
  assert.deepEqual(resolveLinkMode(undefined, { linkMode: "typeOnly" }, "0"), { linkMode: "typeOnly", source: "modelSettings" });
  assert.deepEqual(resolveLinkMode(undefined, {}, "0"), { linkMode: "typeAndInstance", source: "nativeAddin" });
  assert.deepEqual(resolveLinkMode(undefined, { fields: ["id"] }, "1"), { linkMode: "typeOnly", source: "nativeAddin" });
  assert.throws(() => resolveLinkMode(undefined, {}, null), /No link mode chosen/);
  assert.throws(() => resolveLinkMode(undefined, {}, "9"), /No link mode chosen/);
});

// Live probe 2026-09-09: these three POST routes only exist under /api/v1 even
// though the public docs list them as V2; on v2 they are a bare 404. The clone
// POST is the opposite (v2 only). Lock the base per route so a doc-driven
// "cleanup" cannot silently reintroduce the 404s.
test("write routes use the API base that actually serves them, not the documented one", async () => {
  const original = nbsClient.request;
  const calls: any[] = [];
  nbsClient.request = async (path, options) => { calls.push({ path, options }); return {} as any; };
  try {
    await createComponent(10, { name: "MCP-testvæg" });
    await pushSheet({ name: "s", revit_id: "r", project_id: 10, json_array: [] });
    await pushQuantities({ project_id: 10, json_array: [] });
    assert.deepEqual(calls.map(c => [c.path, c.options.method, c.options.useV1]), [
      ["/projects/10/component", "POST", true],
      ["/sheet", "POST", true],
      ["/quantities", "POST", true],
    ]);
  } finally { nbsClient.request = original; }
});

test("project creation uses the documented clone POST and never retries it", async () => {
  const original = nbsClient.request;
  const calls: any[] = [];
  nbsClient.request = async (path, options) => { calls.push({ path, options }); throw new Error("timeout"); };
  try {
    await assert.rejects(cloneProject(10, "Skole & hal"), /timeout/);
    assert.deepEqual(calls, [{ path: "/projects/10?project_name=Skole%20%26%20hal", options: { method: "POST" } }]);
  } finally { nbsClient.request = original; }
});
