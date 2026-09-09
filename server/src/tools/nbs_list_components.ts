import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listComponents } from "../integrations/nbs/components/ComponentService.js";
import { resolveNbsProjectId } from "../integrations/nbs/ProjectConnection.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";

export function registerNbsListComponentsTool(server: McpServer) {
  server.tool(
    "nbs_list_components",
    "List NBS Nordic building components (bygningsdele). Defaults to the project connected to the active Revit model.",
    {
      projectId: z
        .union([z.string(), z.number()])
        .optional()
        .describe("NBS database project ID. Omit to use the project connected to the active Revit model."),
    },
    async (args) => {
      try {
        const projectId = await resolveNbsProjectId(args.projectId);
        const components = await listComponents(projectId);
        return rawToolResponse("nbs_list_components", components);
      } catch (error) {
        return rawToolError("nbs_list_components", `List NBS components failed: ${errorMessage(error)}`);
      }
    }
  );
}
