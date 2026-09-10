import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ROUTING_TOOL_IDS, ToolCatalog } from "../agent/ToolCatalog.js";
import { runtimeRequestSchema } from "../agent/ProductionWorkflowRuntime.js";
import { ConfirmedWorkflowService } from "../agent/ConfirmedWorkflowService.js";
import type { AgentConfig } from "../agent/AgentConfig.js";

// Version of the reviewed routing subset, not a fingerprint of live model data.
export const PLAN_CATALOG_VERSION = "reviewed-routing-subset-v1";

export function registerOrchestrateWorkflowTool(server: McpServer, config?: AgentConfig): void {
  const service = new ConfirmedWorkflowService(new ToolCatalog(PLAN_CATALOG_VERSION, ROUTING_TOOL_IDS), config);
  server.tool(
    "orchestrate_workflow",
    "Two-step workflow: plan with intent and optional concrete request (no Revit/NBS calls). A request issues a five-minute, one-use planId. Review the returned request and plan; execute with confirmed=true, planId and exactly that unchanged plan. Execute uses the current model/selection and can WRITE. A plan without request cannot execute. Never retry a consumed confirmation; inspect the complete WorkflowRun first.",
    {
      mode: z.enum(["plan", "execute"]),
      intent: z.string().trim().min(1).max(10000).optional().describe("Plan only: workflow intent in Danish or English."),
      request: runtimeRequestSchema.optional().describe("Plan only: concrete request to review and bind to this confirmation; authoritative naming/field choices."),
      planId: z.string().uuid().optional(),
      confirmed: z.literal(true).optional(),
      plan: z.object({ schemaVersion: z.number(), intentKind: z.string(), intentSignature: z.string(), catalogFingerprint: z.string(),
        requiresConfirmation: z.boolean(), steps: z.array(z.object({ toolId: z.string(), phase: z.enum(["read", "validate", "write", "verify"]),
          argsTemplate: z.record(z.unknown()) }).strict()).max(20) }).strict().optional(),
    },
    async ({ mode, intent, request, planId, confirmed, plan }) => {
      try {
        let result: unknown;
        if (mode === "plan") {
          if (!intent || planId !== undefined || confirmed !== undefined || plan !== undefined) throw new Error("Plan mode requires intent and optional request only");
          result = service.plan(intent, request);
        } else {
          if (!planId || !plan || confirmed !== true || intent !== undefined || request !== undefined)
            throw new Error("Execute mode requires a previously issued planId, unchanged plan and confirmed=true; no intent/request overrides");
          result = await service.execute(planId, plan);
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
      }
    }
  );
}
