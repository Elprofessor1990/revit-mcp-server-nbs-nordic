import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerGetSelectedElementsTool } from "../tools/get_selected_elements.js";
import { registerGetElementParametersTool } from "../tools/get_element_parameters.js";
import { registerSetElementParametersTool } from "../tools/set_element_parameters.js";
import { registerListSchedulableFieldsTool } from "../tools/list_schedulable_fields.js";
import { registerCreateScheduleTool } from "../tools/create_schedule.js";
import { registerGetScheduleDataTool } from "../tools/get_schedule_data.js";
import { registerBatchRenameTool } from "../tools/batch_rename.js";
import { registerNbsProjectConnectionTools } from "../tools/nbs_project_connection.js";
import { registerSyncRevitTypesToNbsTool, type SyncExecutionHooks } from "../tools/sync_revit_types_to_nbs.js";

const registrations: Record<string, (server: McpServer) => void> = {
  get_selected_elements: registerGetSelectedElementsTool,
  get_element_parameters: registerGetElementParametersTool,
  set_element_parameters: registerSetElementParametersTool,
  list_schedulable_fields: registerListSchedulableFieldsTool,
  create_schedule: registerCreateScheduleTool,
  get_schedule_data: registerGetScheduleDataTool,
  batch_rename: registerBatchRenameTool,
  get_connection_status: registerNbsProjectConnectionTools,
};

export interface ToolExecutor {
  invoke(toolId: string, args: Record<string, unknown>, hooks?: SyncExecutionHooks): Promise<unknown>;
}

/** Private, in-process handler capture. No MCP server, transport or endpoint is
 * started. Reuses the actual schemas (including defaults) and callbacks, without
 * reaching into SDK private fields or modifying any existing registration.
 */
export class ReviewedToolExecutor implements ToolExecutor {
  async invoke(toolId: string, args: Record<string, unknown>, hooks?: SyncExecutionHooks): Promise<unknown> {
    let invoke: (() => Promise<unknown>) | undefined;
    const collector = {
      tool(name: string, _description: string, shape: z.ZodRawShape,
        handler: (args: Record<string, unknown>) => Promise<unknown>) {
        if (name === toolId) invoke = () => handler(z.object(shape).strict().parse(args));
      },
    };
    // These reviewed registration functions only use the four-argument tool API;
    // none of their callbacks uses MCP request context. Contract tests guard it.
    const target = collector as unknown as McpServer;
    if (toolId === "sync_revit_types_to_nbs") registerSyncRevitTypesToNbsTool(target, hooks);
    else if (Object.hasOwn(registrations, toolId)) registrations[toolId](target);
    else throw new Error(`Tool is not an execution primitive: ${toolId}`);
    if (!invoke) throw new Error(`Missing reviewed handler: ${toolId}`);
    return invoke();
  }
}
