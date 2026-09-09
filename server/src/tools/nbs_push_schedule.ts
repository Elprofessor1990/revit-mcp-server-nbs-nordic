import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pushSheet } from "../integrations/nbs/sheets/SheetService.js";
import { resolveNbsProjectId } from "../integrations/nbs/ProjectConnection.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";

export function registerNbsPushScheduleTool(server: McpServer) {
  server.tool(
    "nbs_push_schedule",
    "Push a Revit schedule to NBS Nordic (POST /sheet). Get the schedule data first with " +
      "get_schedule_data, then pass its rows here. NBS documents can reference synced schedules as variables.",
    {
      projectId: z
        .union([z.string(), z.number()])
        .optional()
        .describe("NBS database project ID. Omit to use the project connected to the active Revit model."),
      name: z.string().describe("Sheet name in NBS"),
      revitId: z.string().describe("Identifier of the source Revit schedule/view"),
      rows: z.array(z.record(z.string(), z.unknown())).describe("Schedule rows (from get_schedule_data)."),
    },
    async (args) => {
      try {
        const projectId = await resolveNbsProjectId(args.projectId);
        const result = await pushSheet({
          name: args.name,
          revit_id: args.revitId,
          project_id: projectId,
          json_array: args.rows,
        });
        return rawToolResponse("nbs_push_schedule", result);
      } catch (error) {
        return rawToolError("nbs_push_schedule", `Push NBS schedule failed: ${errorMessage(error)}`);
      }
    }
  );
}
