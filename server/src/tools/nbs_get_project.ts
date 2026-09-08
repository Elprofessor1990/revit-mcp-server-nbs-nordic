import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { nbsClient } from "../integrations/nbs/NbsClient.js";
import { NbsProject } from "../integrations/nbs/NbsTypes.js";
import { resolveProjectId } from "../integrations/nbs/NbsConfig.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";

export function registerNbsGetProjectTool(server: McpServer) {
  server.tool(
    "nbs_get_project",
    "Get a single NBS Nordic project by ID. Falls back to NBS_PROJECT_ID env var if projectId is omitted.",
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
          return rawToolError("nbs_get_project", "No projectId provided and NBS_PROJECT_ID is not set.");
        }
        const project = await nbsClient.request<NbsProject>(`/projects/${projectId}`);
        return rawToolResponse("nbs_get_project", project);
      } catch (error) {
        return rawToolError("nbs_get_project", `Get NBS project failed: ${errorMessage(error)}`);
      }
    }
  );
}
