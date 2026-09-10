import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { ReviewedToolExecutor } from "./ReviewedToolExecutor.js";
import type { ChangeEvidence, StepContext, WorkflowRuntime } from "./WorkflowOrchestrator.js";
import { getModelContext, type RevitNbsContext } from "../integrations/nbs/ProjectConnection.js";
import { fullClassification } from "../integrations/nbs/matching/SyncPlanner.js";
import type { NbsComponent, NbsProject } from "../integrations/nbs/NbsTypes.js";
import type { SyncExecutionPlan } from "../tools/sync_revit_types_to_nbs.js";
import { workflowSteps } from "./WorkflowTemplates.js";

const field = z.object({ parameterName: z.string().trim().min(1), fieldType: z.enum(["Instance", "ElementType"]) }).strict();
const requestSchema = z.discriminatedUnion("intentKind", [
  z.object({ intentKind: z.literal("wall_height"), height: z.number().positive().finite(), unit: z.enum(["mm", "cm", "m", "ft", "in"]) }).strict(),
  z.object({ intentKind: z.literal("create_schedule"), name: z.string().trim().min(1).max(200), fields: z.array(field).min(1).max(20) }).strict(),
  z.object({ intentKind: z.literal("rename_types"), findText: z.string().default(""), replaceText: z.string().default(""),
    prefix: z.string().default(""), suffix: z.string().default(""), acknowledgeTypeWideImpact: z.literal(true) }).strict(),
  z.object({ intentKind: z.literal("sync_classification"), classificationKey: z.string().trim().min(1),
    category: z.enum(["OST_Walls", "OST_Doors", "OST_Windows", "OST_Floors", "OST_Roofs", "OST_Ceilings"]),
    projectId: z.string().regex(/^[1-9]\d*$/) }).strict(),
]);
export type RuntimeRequest = z.input<typeof requestSchema>;
export { requestSchema as runtimeRequestSchema };

/** Existing parameter reader uses AsDouble(), and setter uses Set(double):
 * lengths cross that boundary in Revit internal feet, NOT display units.
 * Only the known, non-shared Unconnected Height parameter is accepted below.
 */
export function heightInInternalFeet(value: number, unit: string): number {
  const factors: Record<string, number> = { mm: 1 / 304.8, cm: 1 / 30.48, m: 1 / 0.3048, ft: 1, in: 1 / 12 };
  if (!Object.hasOwn(factors, unit) || !Number.isFinite(value) || value <= 0) throw new Error("Invalid length or unknown unit");
  const feet = value * factors[unit];
  if (!Number.isFinite(feet) || feet <= 0) throw new Error("Invalid converted height");
  return feet;
}

/** Actual C# DTOs mix PascalCase and JsonProperty camelCase. Normalize casing,
 * but never silently accept ambiguous keys, command errors or truncated data.
 */
function normalize(value: unknown): any {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = key[0].toLowerCase() + key.slice(1);
    if (Object.hasOwn(result, normalized)) throw new Error("Ambiguous result keys");
    result[normalized] = normalize(child);
  }
  if (result._truncated === true || result.success === false || result.isError === true)
    throw new Error("Incomplete or failed tool result");
  return result;
}
function payload(value: unknown): any {
  const result = normalize(value);
  return result && Object.hasOwn(result, "response") ? result.response : result;
}
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function same(actual: unknown, expected: unknown, message: string): void {
  requireThat(isDeepStrictEqual(actual, expected), message);
}
const id = z.number().int().positive().safe();
const selectedSchema = z.array(z.object({ id, uniqueId: z.string().min(1), name: z.string(), category: z.string() }));
type Selected = z.infer<typeof selectedSchema>;
const parameterSchema = z.object({ name: z.string(), value: z.unknown().optional(), storageType: z.string(),
  isReadOnly: z.boolean(), isShared: z.boolean(), hasValue: z.boolean() });
const parameterRows = z.array(z.object({ elementId: id, elementName: z.string(), category: z.string(), parameters: z.array(parameterSchema) }));
type Parameters = z.infer<typeof parameterRows>;
const typesSchema = z.array(z.object({ familyTypeId: id, uniqueId: z.string().min(1), familyName: z.string().min(1), typeName: z.string().min(1), category: z.string() }));
type Types = z.infer<typeof typesSchema>;
const categoryNames: Record<string, string[]> = {
  OST_Walls: ["Walls"], OST_Doors: ["Doors"], OST_Windows: ["Windows"], OST_Floors: ["Floors"], OST_Roofs: ["Roofs"], OST_Ceilings: ["Ceilings"],
};
function unique<T>(items: T[], key: (item: T) => unknown) { return new Set(items.map(key)).size === items.length; }
function parameter(row: Parameters[number], name: string) {
  const matches = row.parameters.filter(p => p.name === name);
  requireThat(matches.length === 1, `Missing/ambiguous parameter ${name} on ${row.elementId}`);
  requireThat(matches[0].hasValue && matches[0].value !== undefined, `No value for ${name}`);
  return matches[0];
}

/** Stateful, single-run production runtime. No MCP registration, writes, cache,
 * or confirmation logic. All reads reuse existing tool handlers/integrations.
 * Unsupported locales, incomplete catalogs and constrained walls fail closed;
 * no localized parameter guesses or client-supplied validation callbacks.
 */
export class ProductionWorkflowRuntime implements WorkflowRuntime {
  private readonly request: z.output<typeof requestSchema>;
  private readonly tools = new ReviewedToolExecutor();
  private model?: RevitNbsContext;
  private selected: Selected = [];
  private types: Types = [];
  private typeIds: number[] = [];
  private instanceTypes = new Map<number, number>();
  private before: Parameters = [];
  private changes: ChangeEvidence[] = [];
  private bindings: Record<string, unknown> = {};
  private expectedRenames: { id: number; oldName: string; newName: string }[] = [];
  private nbsPreview?: SyncExecutionPlan;
  private componentId?: number;
  private createdScheduleId?: number;
  private nextStep = 0;
  private prepared = false;

  constructor(request: RuntimeRequest) { this.request = requestSchema.parse(structuredClone(request)); }

  private async read(toolId: string, args: Record<string, unknown> = {}, observe?: (p: SyncExecutionPlan) => void): Promise<any> {
    const result = await this.tools.invoke(toolId, args, observe ? { beforeWriteOrPreview: async p => observe(p) } : undefined) as any;
    requireThat(!result.isError && result.content?.length === 1 && result.content[0].type === "text", `Failed runtime read: ${toolId}`);
    return payload(JSON.parse(result.content[0].text));
  }
  private async checkModel() {
    const current = await getModelContext();
    requireThat(current.modelKey && current.isReadOnly === false, "Missing model identity/editability evidence or read-only model");
    if (this.model) {
      same(current.modelKey, this.model.modelKey, "Active model changed");
      same(current.projectId, this.model.projectId, "Model NBS project changed");
    } else this.model = structuredClone(current);
  }
  private async selection(): Promise<Selected> {
    const rows = selectedSchema.parse(await this.read("get_selected_elements", { limit: 101 }));
    requireThat(rows.length > 0 && rows.length < 100 && unique(rows, r => r.id) && unique(rows, r => r.uniqueId),
      "Empty, duplicate or potentially truncated selection (maximum 99)");
    return rows.sort((a, b) => a.id - b.id);
  }
  private async catalog(): Promise<Types> {
    const rows = typesSchema.parse(await this.read("get_available_family_types", { limit: 101 }));
    requireThat(rows.length > 0 && rows.length < 100 && unique(rows, r => r.familyTypeId), "Incomplete/ambiguous type catalog (maximum 99)");
    return rows.sort((a, b) => a.familyTypeId - b.familyTypeId);
  }
  private parameters(data: unknown, ids: number[]): Parameters {
    const rows = parameterRows.parse(payload(data)).sort((a, b) => a.elementId - b.elementId);
    same(rows.map(r => r.elementId), [...ids].sort((a, b) => a - b), "Incomplete/duplicate parameter read-back");
    return rows;
  }
  private async readParameters(ids: number[]) {
    return this.parameters(await this.read("get_element_parameters", { elementIds: ids, includeTypeParameters: true, compact: false }), ids);
  }
  private async initialize() {
    await this.checkModel();
    if (this.request.intentKind === "create_schedule") return;
    this.selected = await this.selection();
    this.bindings.selectedElementIds = this.selected.map(e => e.id);
    this.types = await this.catalog();
    const instanceIds = this.selected.filter(e => !this.types.some(t => t.familyTypeId === e.id)).map(e => e.id);
    const rows = instanceIds.length ? await this.readParameters(instanceIds) : [];
    this.typeIds = [...new Set(this.selected.map(e => {
      if (this.types.some(t => t.familyTypeId === e.id)) return e.id;
      const row = rows.find(r => r.elementId === e.id)!;
      const type = parameter(row, "Type");
      requireThat(type.storageType === "ElementId" && !type.isShared, "Cannot establish selected element type");
      const typeId = id.parse(type.value);
      requireThat(this.types.some(t => t.familyTypeId === typeId), "Selected type missing from complete catalog");
      this.instanceTypes.set(e.id, typeId);
      return typeId;
    }))].sort((a, b) => a - b);
    this.bindings.uniqueSelectedTypeIds = this.typeIds;
    if (this.request.intentKind === "wall_height") {
      requireThat(instanceIds.length === this.selected.length && this.selected.every(e => e.category === "Walls"), "Select only wall instances; unsupported category/locale");
    }
    if (this.request.intentKind === "sync_classification") {
      requireThat(instanceIds.length === this.selected.length && this.selected.every(e => categoryNames[this.request.intentKind === "sync_classification" ? this.request.category : ""].includes(e.category)), "Sync requires only instances of the requested category");
      same(this.model!.projectId, this.request.projectId, "Requested NBS project differs from active model");
      this.bindings.validatedCategory = this.request.category;
      this.bindings.expectedProjectId = this.request.projectId;
      await this.resolveNbs();
    }
  }
  private wallRequests(rows: Parameters) {
    requireThat(this.request.intentKind === "wall_height", "Not a wall request");
    const value = heightInInternalFeet(this.request.height, this.request.unit);
    return rows.map(row => {
      const height = parameter(row, "Unconnected Height");
      const top = parameter(row, "Top Constraint");
      requireThat(row.category === "Walls" && !height.isReadOnly && !height.isShared && height.storageType === "Double" && typeof height.value === "number" && Number.isFinite(height.value), "Height is not a writable built-in length");
      requireThat(top.storageType === "ElementId" && top.value === -1 && !top.isShared, "Only unconnected walls are supported");
      // These built-ins expose attachment constraints. Missing evidence is not
      // permission to change a potentially attached wall.
      for (const name of ["Top is Attached", "Base is Attached"]) {
        const p = parameter(row, name);
        requireThat(!p.isShared && p.storageType === "Integer" && p.value === 0, "Attached walls are unsupported");
      }
      return { elementId: row.elementId, parameterName: height.name, value };
    });
  }
  private renamePlan(types: Types) {
    requireThat(this.request.intentKind === "rename_types", "Not a rename request");
    const req = this.request;
    const selected = types.filter(t => this.typeIds.includes(t.familyTypeId));
    requireThat(selected.length === this.typeIds.length, "Missing selected types");
    const renames = selected.map(t => ({ id: t.familyTypeId, oldName: t.typeName,
      newName: req.prefix + (req.findText ? t.typeName.split(req.findText).join(req.replaceText) : t.typeName) + req.suffix }));
    for (const r of renames) {
      requireThat(r.newName.trim() === r.newName && r.newName.length > 0 && r.newName.length <= 200 && !/[\x00-\x1f\\:{}\[\]|;<>?`~]/.test(r.newName), "Invalid new type name");
      const owner = selected.find(t => t.familyTypeId === r.id)!;
      const peers = types.filter(t => t.category === owner.category && t.familyName === owner.familyName && t.familyTypeId !== r.id);
      requireThat(!peers.some(t => t.typeName.toLowerCase() === r.newName.toLowerCase()), "Name collision with existing sibling type (including swaps)");
      requireThat(!renames.some(other => other.id !== r.id && other.newName.toLowerCase() === r.newName.toLowerCase() &&
        selected.find(t => t.familyTypeId === other.id)!.familyName === owner.familyName && selected.find(t => t.familyTypeId === other.id)!.category === owner.category), "Many-to-one rename collision");
    }
    requireThat(renames.every(r => r.oldName !== r.newName), "No-op/partially unchanged rename requires a narrower request");
    return renames;
  }
  private async noScheduleCollision() {
    requireThat(this.request.intentKind === "create_schedule", "Not a schedule request");
    const data = await this.read("get_schedule_data", {});
    const rows = z.array(z.object({ id, name: z.string() })).parse(data.schedules ?? (data.scheduleCount === 0 ? [] : undefined));
    requireThat(rows.length === data.scheduleCount, "Incomplete schedule list");
    requireThat(!rows.some(r => r.name.toLowerCase() === this.requestName().toLowerCase()), "Schedule name already exists");
  }
  private requestName() { return this.request.intentKind === "create_schedule" ? this.request.name : ""; }
  private scheduleFields(data: any) {
    requireThat(this.request.intentKind === "create_schedule", "Not a schedule request");
    requireThat(data.category === "OST_Walls" && data.scheduleType === "regular", "Wrong schedule category/type");
    const fields = z.array(z.object({ name: z.string(), fieldType: z.string(), parameterId: z.number().int() })).parse(data.fields);
    requireThat(fields.length === data.fieldCount && unique(this.request.fields, f => f.parameterName.toLowerCase()), "Incomplete/duplicate schedule fields");
    for (const requested of this.request.fields) {
      const matches = fields.filter(f => f.name.toLowerCase() === requested.parameterName.toLowerCase());
      // Existing create_schedule ignores requested fieldType and selects first by
      // name. Refuse even if one of two same-name fields has the desired scope.
      requireThat(matches.length === 1 && matches[0].fieldType === requested.fieldType, "Unknown/ambiguous schedule field or incorrect type/instance scope");
    }
    return this.request.fields.map(f => ({ ...f, parameterName: fields.find(candidate => candidate.name.toLowerCase() === f.parameterName.toLowerCase())!.name }));
  }
  private async resolveNbs() {
    requireThat(this.request.intentKind === "sync_classification", "Not NBS");
    const args = { projectId: this.request.projectId };
    const project = await this.read("nbs_get_project", args) as NbsProject;
    same(String(project.id), this.request.projectId, "Foreign NBS project");
    const components = await this.read("nbs_list_components", args) as NbsComponent[];
    requireThat(Array.isArray(components), "Missing NBS component list");
    const key = this.request.classificationKey;
    const matches = components.filter(c => c.active !== false && c.active !== 0 && fullClassification(c, project) === key);
    requireThat(matches.length === 1, "Shared NBS key is missing or ambiguous");
    const component = id.parse(matches[0].id);
    if (this.componentId !== undefined) same(component, this.componentId, "NBS key now resolves to another component");
    this.componentId = component;
  }
  private checkNbsScope(observed: SyncExecutionPlan, after = false) {
    requireThat(this.request.intentKind === "sync_classification" && observed.snapshot, "Missing NBS scope evidence");
    const snapshot = observed.snapshot;
    same(observed.modelKey, this.model!.modelKey, "NBS preview model changed");
    same(observed.projectId, this.request.projectId, "NBS project changed");
    same(observed.category, this.request.category, "NBS category changed");
    requireThat(!observed.unresolved && observed.dryRun, "Incomplete NBS preview");
    same(snapshot.instances.map(e => e.uniqueId).sort(), this.selected.map(e => e.uniqueId).sort(), "Category-wide sync would expand selected instance scope");
    same(snapshot.types.map(t => t.typeId).sort((a, b) => a - b), this.typeIds, "Category-wide sync would expand selected type scope");
    for (const element of [...snapshot.types, ...snapshot.instances]) {
      const instance = "id" in element;
      const link = instance ? "NBS Component Instance Id" : "NBS Component Type Id";
      same(element.parameters[link], String(this.componentId), "Independent NBS link does not match requested shared key; no implicit remapping");
      if (after) same(element.parameters[instance ? "NBS Instance Classificationcode" : "NBS Classificationcode"], this.request.classificationKey, "NBS read-back differs from requested key");
    }
    const allowed = new Set([...this.selected.map(e => e.uniqueId), ...this.types.filter(t => this.typeIds.includes(t.familyTypeId)).map(t => t.uniqueId)]);
    for (const r of observed.requests) requireThat(allowed.has(r.uniqueId) && ["NBS Classificationcode", "NBS Instance Classificationcode"].includes(r.parameterName) && r.value === this.request.classificationKey, "NBS plan contains unrelated changes");
    if (after) requireThat(observed.requests.length === 0, "NBS post-write preview is not a no-op");
  }
  private async captureNbs(after = false): Promise<SyncExecutionPlan> {
    requireThat(this.request.intentKind === "sync_classification", "Not NBS");
    let observed: SyncExecutionPlan | undefined;
    await this.read("sync_revit_types_to_nbs", { category: this.request.category, projectId: this.request.projectId,
      linkMode: "typeAndInstance", fields: ["classificationcode"], dryRun: true }, p => { observed = structuredClone(p); });
    requireThat(observed, "NBS handler omitted scope evidence");
    this.checkNbsScope(observed, after);
    return observed;
  }

  async prepare(context: StepContext) {
    requireThat(context.stepIndex === this.nextStep && !this.prepared, "Runtime is single-run and sequential");
    same(context.step, workflowSteps(this.request.intentKind)[context.stepIndex], "Runtime intent/template mismatch");
    if (!this.model) await this.initialize();
    await this.checkModel();
    if (this.selected.length) {
      const identity = (rows: Selected) => rows.map(({ name, ...r }) => r);
      same(identity(await this.selection()), identity(this.selected), "Selection changed");
    }
    if (context.step.phase === "write") {
      if (this.request.intentKind === "wall_height") {
        const current = await this.readParameters(this.selected.map(e => e.id));
        same(current, this.before, "Wall data changed since validation");
        this.wallRequests(current);
      } else if (this.request.intentKind === "rename_types") {
        if (this.instanceTypes.size) {
          const current = await this.readParameters([...this.instanceTypes.keys()]);
          for (const row of current) same(parameter(row, "Type").value, this.instanceTypes.get(row.elementId), "Selected instance changed type since preview");
        }
        same(this.renamePlan(await this.catalog()), this.expectedRenames, "Rename preview became stale");
      } else if (this.request.intentKind === "create_schedule") {
        await this.noScheduleCollision();
        same(this.scheduleFields(await this.read("list_schedulable_fields", { categoryName: "OST_Walls", scheduleType: "regular" })), this.bindings.validatedScheduleFields, "Schedule fields changed");
      } else {
        await this.resolveNbs();
        same(await this.captureNbs(), this.nbsPreview, "NBS preview changed before write");
      }
    }
    if (this.request.intentKind === "sync_classification" && context.step.phase === "validate") await this.resolveNbs();
    this.prepared = true;
    return { bindings: structuredClone(this.bindings), changes: context.step.phase === "write" ? structuredClone(this.changes) : [] };
  }

  async assess(context: StepContext, result: unknown): Promise<boolean> {
    requireThat(this.prepared && context.stepIndex === this.nextStep, "Unexpected runtime assessment");
    const data = payload(result);
    await this.checkModel();
    if (context.step.toolId === "get_selected_elements") same(selectedSchema.parse(data).sort((a, b) => a.id - b.id), this.selected, "Selected elements differ");
    else if (this.request.intentKind === "wall_height") {
      if (context.step.phase === "validate") {
        this.before = this.parameters(data, this.selected.map(e => e.id));
        const requests = this.wallRequests(this.before);
        this.bindings.validatedHeightRequests = requests;
        this.changes = requests.map(r => ({ targetKind: "instance_parameter", targetId: `${r.elementId}/${r.parameterName}`,
          oldValue: parameter(this.before.find(row => row.elementId === r.elementId)!, r.parameterName).value, newValue: r.value }));
      } else if (context.step.phase === "verify") {
        const requests = this.bindings.validatedHeightRequests as { elementId: number; parameterName: string; value: number }[];
        const rows = this.parameters(data, requests.map(r => r.elementId));
        this.wallRequests(rows);
        for (const r of requests) {
          const actual = parameter(rows.find(row => row.elementId === r.elementId)!, r.parameterName).value;
          requireThat(typeof actual === "number" && Math.abs(actual - r.value) <= 1e-8, "Height read-back mismatch (internal feet)");
        }
      } else {
        const rows = z.array(z.object({ elementId: id, parameterName: z.string(), success: z.literal(true) })).parse(data);
        same(rows.map(r => `${r.elementId}/${r.parameterName}`).sort(), this.changes.map(c => c.targetId).sort(), "Partial parameter write result");
      }
    } else if (this.request.intentKind === "rename_types") {
      if (context.step.toolId === "get_element_parameters") {
        const rows = this.parameters(data, this.typeIds);
        if (context.step.phase === "validate") {
          this.expectedRenames = this.renamePlan(this.types);
          for (const r of this.expectedRenames) same(rows.find(row => row.elementId === r.id)!.elementName, r.oldName, "Type name differs from catalog");
          Object.assign(this.bindings, { findText: this.request.findText, replaceText: this.request.replaceText, prefix: this.request.prefix, suffix: this.request.suffix });
          this.changes = this.expectedRenames.map(r => ({ targetKind: "type_name", targetId: String(r.id), oldValue: r.oldName, newValue: r.newName }));
        } else for (const r of this.expectedRenames) same(rows.find(row => row.elementId === r.id)!.elementName, r.newName, "Type name read-back mismatch");
      } else {
        same(data.dryRun, context.step.phase === "validate", "Rename mode mismatch");
        const renames = z.array(z.object({ id, oldName: z.string(), newName: z.string(), success: z.literal(true) })).parse(data.renames);
        same(renames.map(({ success, ...r }) => r).sort((a, b) => a.id - b.id), this.expectedRenames, "Rename preview/result differs from requested naming rule");
        same(data.successCount, this.expectedRenames.length, "Partial rename");
      }
    } else if (this.request.intentKind === "create_schedule") {
      if (context.step.phase === "validate") {
        this.bindings.validatedScheduleFields = this.scheduleFields(data);
        this.bindings.scheduleName = this.request.name;
        await this.noScheduleCollision();
        this.changes = [{ targetKind: "schedule", targetId: this.request.name, oldValue: null, newValue: { name: this.request.name, fields: this.request.fields } }];
      } else if (context.step.phase === "write") {
        same(data.name, this.request.name, "Schedule handler renamed the requested schedule");
        this.createdScheduleId = id.parse(data.scheduleId);
        this.bindings.createdScheduleId = this.createdScheduleId;
      } else {
        same(data.scheduleName, this.request.name, "Schedule name read-back mismatch");
        same(data.columnHeaders, (this.bindings.validatedScheduleFields as { parameterName: string }[]).map(f => f.parameterName), "Schedule columns/order read-back mismatch");
        same(data.fieldCount, this.request.fields.length, "Schedule field count mismatch");
        const listing = await this.read("get_schedule_data", {});
        const match = (listing.schedules ?? []).filter((s: any) => s.id === this.createdScheduleId);
        requireThat(match.length === 1 && match[0].category === "Walls", "Created schedule category/read-back missing");
      }
    } else {
      if (context.step.phase === "read") {
        same(data.revit?.modelKey, this.model!.modelKey, "Connection model mismatch");
        requireThat(data.nbs?.connected === true, "NBS unavailable");
      } else if (context.step.phase === "validate") this.nbsPreview = await this.captureNbs();
      else {
        requireThat(data.verified === true, "NBS transaction verification missing");
        await this.resolveNbs();
        await this.captureNbs(true); // Separate snapshot after commit; compare actual type AND instance strings.
      }
    }
    this.prepared = false;
    this.nextStep++;
    return true;
  }
}
