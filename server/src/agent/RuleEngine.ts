import type { WorkflowPlan, RuleDecision } from "./types.js";
import { ROUTING_TOOL_IDS, ToolCatalog } from "./ToolCatalog.js";
import { SIGNATURES, workflowSteps } from "./WorkflowTemplates.js";
import type { KnownIntent } from "./IntentNormalizer.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Pure plan-policy validation. An allowed plan is NOT execution authorization.
 * v1 permits only reviewed templates, including their validate/verify structure.
 * Cache/fuzzy candidates cannot supply a weaker rule set or literal model data.
 */
export class RuleEngine {
  private readonly allowList: ReadonlySet<string>;
  constructor(private readonly catalog: ToolCatalog, allowedTools: readonly string[] = ROUTING_TOOL_IDS) {
    this.allowList = new Set(allowedTools);
  }

  evaluate(plan: WorkflowPlan): RuleDecision {
    const deny = (code: string, reason: string): RuleDecision => ({ allowed: false, code, reasons: [reason] });
    if (plan.schemaVersion !== 1 || plan.catalogFingerprint !== this.catalog.fingerprint)
      return deny("stale_contract", "Workflow schema or catalog fingerprint differs.");
    if (!plan.steps.length || plan.steps.length > 20)
      return deny("step_limit", "A plan must contain 1–20 steps.");
    for (const step of plan.steps) {
      if (step.toolId === "send_code_to_revit") return deny("unsafe_tool", "Automatic custom-code execution is prohibited.");
      if (!this.catalog.has(step.toolId) || !this.allowList.has(step.toolId))
        return deny("tool_not_allowed", `Tool is absent from catalog or allow-list: ${step.toolId}`);
    }
    if (!Object.prototype.hasOwnProperty.call(SIGNATURES, plan.intentKind))
      return deny("unsupported_intent", "Only reviewed v1 workflows are allowed.");
    const kind = plan.intentKind as KnownIntent;
    if (!plan.requiresConfirmation) return deny("confirmation_required", "All v1 workflows include writes.");
    if (plan.intentSignature !== SIGNATURES[kind] || canonical(plan.steps) !== canonical(workflowSteps(kind)))
      return deny("unapproved_workflow", "Plan must preserve reviewed arguments, read/validate/write/verify ordering and atomic NBS sync.");
    return { allowed: true, code: "plan_allowed", reasons: [] };
  }
}
