import { normalizeIntent, type NormalizedIntent } from "./IntentNormalizer.js";
import { ToolCatalog } from "./ToolCatalog.js";
import { RuleEngine } from "./RuleEngine.js";
import { obligations, workflowSteps } from "./WorkflowTemplates.js";
import type { WorkflowPlan } from "./types.js";

export type RoutingResult =
  | { status: "planned"; source: "deterministic"; plan: WorkflowPlan;
      bindings: NormalizedIntent["bindings"]; executionObligations: string[]; executable: false }
  | { status: "fallback"; reason: string; discovery: "normal_mcp_discovery_and_explicit_planning" };

/** Pure, additive planning API. No tools, cache, Revit or NBS calls are performed.
 * Deterministic templates take priority; v1 deliberately falls back rather than
 * introducing a fuzzy selector before it is reviewed.
 */
export class IntentRouter {
  private readonly rules: RuleEngine;
  constructor(private readonly catalog: ToolCatalog, allowedTools?: readonly string[]) {
    this.rules = new RuleEngine(catalog, allowedTools);
  }
  route(input: string): RoutingResult {
    const intent = normalizeIntent(input);
    const fallback = (reason: string): RoutingResult => ({ status: "fallback", reason, discovery: "normal_mcp_discovery_and_explicit_planning" });
    if (!intent) return fallback("unknown_intent");
    const plan: WorkflowPlan = {
      schemaVersion: 1, intentKind: intent.kind, intentSignature: intent.signature,
      catalogFingerprint: this.catalog.fingerprint, steps: workflowSteps(intent.kind), requiresConfirmation: true,
    };
    const decision = this.rules.evaluate(plan);
    if (!decision.allowed) return fallback(decision.code);
    return { status: "planned", source: "deterministic", plan, bindings: intent.bindings,
      executionObligations: obligations(intent.kind), executable: false };
  }
}
