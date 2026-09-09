import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { IntentRouter } from "../agent/IntentRouter.js";
import { ROUTING_TOOL_IDS, ToolCatalog } from "../agent/ToolCatalog.js";

// Version of the reviewed routing subset, not a fingerprint of live model data.
export const PLAN_CATALOG_VERSION = "reviewed-routing-subset-v1";

export function registerOrchestrateWorkflowTool(server: McpServer): void {
  const router = new IntentRouter(new ToolCatalog(PLAN_CATALOG_VERSION, ROUTING_TOOL_IDS));
  server.tool(
    "orchestrate_workflow",
    "Plan a reviewed Revit/NBS workflow without executing it. Returns the router's plan or explicit discovery fallback. No Revit/NBS calls are made. Execute mode is unsupported.",
    {
      mode: z.literal("plan").describe("Only plan is supported; execute is rejected."),
      intent: z.string().trim().min(1).max(10000).describe("Workflow request in Danish or English."),
    },
    async ({ intent }) => ({
      content: [{ type: "text" as const, text: JSON.stringify(router.route(intent)) }],
    })
  );
}
