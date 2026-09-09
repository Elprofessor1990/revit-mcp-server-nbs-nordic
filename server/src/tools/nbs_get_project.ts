import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { nbsClient } from "../integrations/nbs/NbsClient.js";
import { NbsProject } from "../integrations/nbs/NbsTypes.js";
import { resolveNbsProjectId } from "../integrations/nbs/ProjectConnection.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";

export function registerNbsGetProjectTool(server: McpServer) {
  server.tool(
    "nbs_get_project",
    "Get an NBS Nordic project by ID, or the project connected to the active Revit model.",
    {
      projectId: z
        .union([z.string(), z.number()])
        .optional()
        .describe("NBS database project ID. Omit to use the project connected to the active Revit model."),
    },
    async (args) => {
      try {
        const projectId = await resolveNbsProjectId(args.projectId);
        const project = await nbsClient.request<NbsProject>(`/projects/${projectId}`);
        return rawToolResponse("nbs_get_project", project);
      } catch (error) {
        return rawToolError("nbs_get_project", `Get NBS project failed: ${errorMessage(error)}`);
      }
    }
  );
}
