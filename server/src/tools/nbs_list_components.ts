import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listComponents } from "../integrations/nbs/components/ComponentService.js";
import { resolveProjectId } from "../integrations/nbs/NbsConfig.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";

export function registerNbsListComponentsTool(server: McpServer) {
  server.tool(
    "nbs_list_components",
    "List NBS Nordic building components (bygningsdele) for a project. Falls back to NBS_PROJECT_ID env var if projectId is omitted.",
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
          return rawToolError("nbs_list_components", "No projectId provided and NBS_PROJECT_ID is not set.");
        }
        const components = await listComponents(projectId);
        return rawToolResponse("nbs_list_components", components);
      } catch (error) {
        return rawToolError("nbs_list_components", `List NBS components failed: ${errorMessage(error)}`);
      }
    }
  );
}
