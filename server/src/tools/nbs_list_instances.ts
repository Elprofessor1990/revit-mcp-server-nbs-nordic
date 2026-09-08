import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { nbsClient } from "../integrations/nbs/NbsClient.js";
import { NbsInstancesListResponse } from "../integrations/nbs/NbsTypes.js";
import { resolveProjectId } from "../integrations/nbs/NbsConfig.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";

export function registerNbsListInstancesTool(server: McpServer) {
  server.tool(
    "nbs_list_instances",
    "List all NBS Nordic project instances (linked model elements) with their component links and instance parameters. " +
      "Falls back to NBS_PROJECT_ID env var if projectId is omitted.",
    {
      projectId: z
        .union([z.string(), z.number()])
        .optional()
        .describe("NBS project ID. Omit to use the NBS_PROJECT_ID environment variable."),
    },
    async (args) => {
      try {
        const projectId = resolveProjectId(args.projectId);
        if (!projectId) {
          return rawToolError("nbs_list_instances", "No projectId provided and NBS_PROJECT_ID is not set.");
        }
        const response = await nbsClient.request<NbsInstancesListResponse>(`/projects/${projectId}/instances`);
        return rawToolResponse("nbs_list_instances", response.instances);
      } catch (error) {
        return rawToolError("nbs_list_instances", `List NBS instances failed: ${errorMessage(error)}`);
      }
    }
  );
}
