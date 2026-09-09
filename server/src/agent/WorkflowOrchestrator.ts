import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AuditSink } from "./audit/AuditSink.js";
import type { AuditEvent, WorkflowPlan, WorkflowStep } from "./types.js";
import { RuleEngine } from "./RuleEngine.js";
import type { ToolExecutor } from "./ReviewedToolExecutor.js";
import type { SyncExecutionPlan } from "../tools/sync_revit_types_to_nbs.js";

export type ChangeEvidence = Pick<AuditEvent, "targetKind" | "targetId" | "oldValue" | "newValue">;
export interface StepContext {
  step: WorkflowStep;
  stepIndex: number;
  results: readonly unknown[];
}

/** Trusted code supplies live bindings and semantic validation/read-back. These
 * functions are NOT deserializable client inputs or a confirmation mechanism.
 * Missing evidence fails closed. No prompt-to-arguments guessing belongs here.
 */
export interface WorkflowRuntime {
  prepare(context: StepContext): Promise<{ bindings: Record<string, unknown>; changes?: ChangeEvidence[] }>;
  assess(context: StepContext, result: unknown): Promise<boolean>;
}

export interface WorkflowError {
  code: string;
  message: string;
  stage: "policy" | "prepare" | "invoke" | "verify" | "audit";
  stepIndex: number;
  toolId: string;
}
export interface WorkflowRun {
  runId: string;
  status: "success" | "failure";
  verified: boolean;
  completedSteps: number;
  // There is no cross-tool transaction/compensation. Never invent a rollback.
  mutationState: "none" | "may_have_changes";
  error?: WorkflowError;
}

function bind(value: unknown, bindings: Record<string, unknown>): unknown {
  if (typeof value === "string" && value.startsWith("$")) {
    const key = value.slice(1);
    if (!Object.hasOwn(bindings, key) || bindings[key] === undefined) throw new Error(`Missing binding: ${key}`);
    return structuredClone(bindings[key]);
  }
  if (Array.isArray(value)) return value.map(v => bind(v, bindings));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bind(v, bindings)]));
  return value;
}

/** Fail closed for MCP errors, command-level errors and nested batch failures. */
function hasFailure(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj.success === false || obj.isError === true || obj.verified === false ||
    (typeof obj.error === "string" && obj.error.length > 0) ||
    ["failure", "failed", "partial_success", "rolled_back"].includes(String(obj.status)) ||
    (typeof obj.failedCount === "number" && obj.failedCount > 0) ||
    (Array.isArray(obj.errors) && obj.errors.length > 0)) return true;
  return Object.values(obj).some(v => typeof v === "object" && hasFailure(v));
}

function decode(result: unknown): unknown {
  const response = result as { isError?: boolean; content?: { type: string; text?: string }[] };
  if (response?.isError) throw new Error(response.content?.map(c => c.text ?? "").join("\n") || "Tool failed");
  const text = response?.content?.filter(c => c.type === "text");
  if (!text || text.length !== 1 || typeof text[0].text !== "string") throw new Error("Missing structured tool result");
  const data: unknown = JSON.parse(text[0].text);
  if (data === null || typeof data !== "object" || hasFailure(data)) throw new Error(`Tool reported failure: ${text[0].text}`);
  return data;
}

/** Internal execution kernel only: deliberately not imported by MCP registration
 * or orchestrate_workflow. Caller must own selection/units/identity checks in the
 * runtime; confirmed execution and cache feedback are separate future work.
 */
export class WorkflowOrchestrator {
  constructor(private readonly rules: RuleEngine, private readonly tools: ToolExecutor,
    private readonly audit: AuditSink) {}

  async run(input: WorkflowPlan, runtime: WorkflowRuntime): Promise<WorkflowRun> {
    const plan = structuredClone(input);
    const run: WorkflowRun = { runId: randomUUID(), status: "failure", verified: false,
      completedSteps: 0, mutationState: "none" };
    const results: unknown[] = [];
    let preview: SyncExecutionPlan | undefined;
    let pendingWrite: { index: number; step: WorkflowStep; changes: ChangeEvidence[] } | undefined;
    let stage: WorkflowError["stage"] = "policy";
    let index = 0;
    let changes: ChangeEvidence[] = [];
    const log = async (step: WorkflowStep, i: number, evidence: ChangeEvidence[], outcome: AuditEvent["outcome"],
      verified: boolean, errorCode?: string, errorMessage?: string) => {
      await this.audit.append({ timestamp: Date.now(), runId: run.runId, intentKind: plan.intentKind,
        toolId: step.toolId, targetKind: "step", targetId: String(i), oldValue: null, newValue: null,
        outcome, verified, errorCode, errorMessage });
      for (const change of evidence) await this.audit.append({ ...change, timestamp: Date.now(),
        runId: run.runId, intentKind: plan.intentKind, toolId: step.toolId, outcome, verified, errorCode, errorMessage });
    };
    try {
      const decision = this.rules.evaluate(plan);
      if (!decision.allowed) throw new Error(`${decision.code}: ${decision.reasons.join("; ")}`);
      for (index = 0; index < plan.steps.length; index++) {
        const step = plan.steps[index];
        const context = (): StepContext => ({ step: structuredClone(step), stepIndex: index, results: structuredClone(results) });
        changes = [];
        stage = "audit";
        // Conservative write-ahead record: a crash cannot look like a successful
        // step. v1 AuditEvent has no pending outcome, so mark incomplete as failure.
        await log(step, index, [], "failure", false, "step_incomplete", "Step started; awaiting terminal audit event.");
        stage = "prepare";
        const prepared = await runtime.prepare(context());
        const args = bind(step.argsTemplate, prepared.bindings) as Record<string, unknown>;
        changes = structuredClone(prepared.changes ?? []);
        if (changes.some(c => !c.targetId || !c.targetKind || c.oldValue === undefined || c.newValue === undefined))
          throw new Error("Incomplete old/new change evidence");
        if (step.phase === "write" && step.toolId !== "sync_revit_types_to_nbs" && !changes.length)
          throw new Error("Write requires old/new change evidence from live validation");
        stage = "audit";
        if (changes.length) await log(step, index, changes, "failure", false, "step_incomplete");
        stage = "invoke";
        if (step.phase === "write") run.mutationState = "may_have_changes";
        let observedThisCall = false;
        const result = decode(await this.tools.invoke(step.toolId, args, {
          beforeWriteOrPreview: async observed => {
            const current = structuredClone(observed);
            changes = current.requests.map(r => ({ targetKind: r.parameterName.startsWith("NBS Instance ") ? "instance_parameter" : "type_parameter",
              targetId: `${r.uniqueId}/${r.parameterName}`, oldValue: r.previousValue, newValue: r.value }));
            if (current.unresolved) throw new Error("NBS has unresolved matches; partial sync is not workflow success");
            observedThisCall = true;
            if (step.phase === "validate" && current.dryRun) preview = current;
            else if (step.phase === "write" && !current.dryRun) {
              if (!preview || !isDeepStrictEqual({ ...preview, dryRun: false }, current))
                throw new Error("NBS preview changed: model/project/category or parameter requests differ");
              stage = "audit";
              await log(step, index, changes, "failure", false, "step_incomplete");
              stage = "invoke";
            } else throw new Error("Unexpected NBS execution phase");
          },
        }));
        stage = "verify";
        if (step.toolId === "sync_revit_types_to_nbs") {
          if (!preview || !observedThisCall) throw new Error("NBS handler did not supply preview/write evidence");
          const sync = result as Record<string, unknown>;
          if (step.phase === "write" && (sync.verified !== true || sync.writtenParameters !== changes.length))
            throw new Error("NBS write lacks complete verification");
        }
        if (await runtime.assess(context(), structuredClone(result)) !== true)
          throw new Error("Semantic validation/read-back did not verify the requested outcome");
        const verified = step.phase !== "write" || step.toolId === "sync_revit_types_to_nbs";
        stage = "audit";
        await log(step, index, changes, "success", verified);
        if (step.phase === "write" && !verified) pendingWrite = { index, step, changes };
        if (step.phase === "verify" && pendingWrite) {
          await log(pendingWrite.step, pendingWrite.index, pendingWrite.changes, "success", true);
          pendingWrite = undefined;
        }
        results.push(result);
        run.completedSteps++;
      }
      if (pendingWrite) throw new Error("Write remains unverified");
      return { ...run, status: "success", verified: true };
    } catch (error) {
      const step = plan.steps[index] ?? { toolId: "workflow", phase: "validate", argsTemplate: {} };
      run.error = { code: `${stage}_failure`, message: error instanceof Error ? error.message : String(error),
        stage, stepIndex: index, toolId: step.toolId };
      try {
        await log(step, index, changes, "failure", false, run.error.code, run.error.message);
        if (pendingWrite) await log(pendingWrite.step, pendingWrite.index, pendingWrite.changes,
          "failure", false, "verification_incomplete", run.error.message);
      } catch (auditError) {
        run.error = { ...run.error, code: "audit_failure", stage: "audit",
          message: `${run.error.message}; audit persistence failed: ${String(auditError)}` };
      }
      return run;
    }
  }
}
