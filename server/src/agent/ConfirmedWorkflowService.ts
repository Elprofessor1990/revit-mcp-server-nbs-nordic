import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { IntentRouter } from "./IntentRouter.js";
import { RuleEngine } from "./RuleEngine.js";
import { ToolCatalog } from "./ToolCatalog.js";
import { ProductionWorkflowRuntime, runtimeRequestSchema, heightInInternalFeet, type RuntimeRequest } from "./ProductionWorkflowRuntime.js";
import { WorkflowOrchestrator } from "./WorkflowOrchestrator.js";
import { ReviewedToolExecutor } from "./ReviewedToolExecutor.js";
import { SqliteWorkflowCache } from "./cache/SqliteWorkflowCache.js";
import { SqliteAuditSink } from "./audit/SqliteAuditSink.js";
import { readAgentConfig, type AgentConfig } from "./AgentConfig.js";
import type { WorkflowPlan } from "./types.js";

interface IssuedPlan { plan: WorkflowPlan; request: RuntimeRequest; expiresAt: number }
/** Session-local, bounded, one-use confirmations. Not the reusable workflow
 * cache: concrete requests never enter plan_json. Restart requires replanning.
 */
export class ConfirmedWorkflowService {
  private readonly issued = new Map<string, IssuedPlan>();
  private busy = false;
  private readonly router: IntentRouter;
  private readonly rules: RuleEngine;
  constructor(catalog: ToolCatalog, private readonly config: AgentConfig = readAgentConfig(),
    private readonly now: () => number = Date.now) {
    this.router = new IntentRouter(catalog);
    this.rules = new RuleEngine(catalog);
  }
  plan(intent: string, input?: RuntimeRequest) {
    const routed = this.router.route(intent);
    if (input === undefined || routed.status !== "planned") return routed;
    const request = runtimeRequestSchema.parse(input);
    if (request.intentKind !== routed.plan.intentKind) throw new Error("Request and plan intent differ");
    if (request.intentKind === "wall_height" && Math.abs(heightInInternalFeet(request.height, request.unit) - Number(routed.bindings.heightMm) / 304.8) > 1e-8)
      throw new Error("Request height differs from planned intent");
    if (request.intentKind === "sync_classification" && request.classificationKey !== routed.bindings.sharedKey)
      throw new Error("Request classification key differs from planned intent");
    for (const [key, value] of this.issued) if (value.expiresAt <= this.now()) this.issued.delete(key);
    if (this.issued.size >= 100) this.issued.delete(this.issued.keys().next().value!);
    const planId = randomUUID();
    const expiresAt = this.now() + 5 * 60_000;
    this.issued.set(planId, { plan: structuredClone(routed.plan), request: structuredClone(request), expiresAt });
    return { ...routed, confirmation: { planId, expiresAt, request: structuredClone(request),
      scope: "Current selection/model at execution time; runtime rejects scope changes during the run. Review this concrete request before confirming." } };
  }
  async execute(planId: string, plan: WorkflowPlan) {
    const issued = this.issued.get(planId);
    if (!issued || issued.expiresAt <= this.now()) { this.issued.delete(planId); throw new Error("Unknown, consumed or expired plan; call mode plan again"); }
    const decision = this.rules.evaluate(plan);
    if (!decision.allowed || !isDeepStrictEqual(plan, issued.plan)) throw new Error("Changed/unapproved plan rejected");
    if (this.busy) throw new Error("Another workflow is running; retry this confirmation later");
    // Consume synchronously before any await: concurrent calls and transport
    // retries cannot run a possibly committed write a second time.
    this.issued.delete(planId);
    this.busy = true;
    let audit: SqliteAuditSink | undefined;
    let cache: SqliteWorkflowCache | undefined;
    let cacheFeedback = "recorded";
    const cleanupWarnings: string[] = [];
    try {
      audit = await SqliteAuditSink.open({ filePath: this.config.auditLogPath });
      try { cache = await SqliteWorkflowCache.open({ filePath: this.config.workflowCachePath, ...this.config.cache }); }
      catch { cacheFeedback = "unavailable"; }
      const started = this.now();
      const run = await new WorkflowOrchestrator(this.rules, new ReviewedToolExecutor(), audit)
        .run(issued.plan, new ProductionWorkflowRuntime(issued.request));
      if (cache) {
        try {
          if (run.status === "success" && run.verified) await cache.recordSuccess(issued.plan, Math.max(0, this.now() - started));
          else await cache.recordFailure(issued.plan, run.error?.code ?? "workflow_failure");
        } catch { cacheFeedback = "failed"; }
      }
      // Do not turn a cache failure into a write failure: return the complete,
      // unchanged WorkflowRun so clients do not mistakenly retry a committed run.
      return { ...run, cacheFeedback, cleanupWarnings };
    } finally {
      // Cleanup must never hide the run result after a possibly committed write.
      try { cache?.close(); } catch { cleanupWarnings.push("cache_close_failed"); }
      try { audit?.close(); } catch { cleanupWarnings.push("audit_close_failed"); }
      this.busy = false;
    }
  }
}
