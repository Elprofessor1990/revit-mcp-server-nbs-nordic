import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { nbsClient } from "../integrations/nbs/NbsClient.js";
import { NbsInstancesListResponse } from "../integrations/nbs/NbsTypes.js";
import { resolveNbsProjectId } from "../integrations/nbs/ProjectConnection.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";

export function registerNbsListInstancesTool(server: McpServer) {
  server.tool(
    "nbs_list_instances",
    "List all NBS Nordic project instances (linked model elements) with their component links and instance parameters. " +
      "Defaults to the project connected to the active Revit model.",
    {
      projectId: z
        .union([z.string(), z.number()])
        .optional()
        .describe("NBS database project ID. Omit to use the project connected to the active Revit model."),
    },
    async (args) => {
      try {
        const projectId = await resolveNbsProjectId(args.projectId);
        const response = await nbsClient.request<NbsInstancesListResponse>(`/projects/${projectId}/instances`);
        return rawToolResponse("nbs_list_instances", response.instances);
      } catch (error) {
        return rawToolError("nbs_list_instances", `List NBS instances failed: ${errorMessage(error)}`);
      }
    }
  );
}
