import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { nbsClient } from "../integrations/nbs/NbsClient.js";
import { NbsProject } from "../integrations/nbs/NbsTypes.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";

export function registerNbsListProjectsTool(server: McpServer) {
  server.tool(
    "nbs_list_projects",
    "List NBS Nordic projects accessible with the configured API key. Requires NBS_API_KEY to be set.",
    {},
    async () => {
      try {
        const projects = await nbsClient.request<NbsProject[]>("/projects");
        return rawToolResponse("nbs_list_projects", projects);
      } catch (error) {
        return rawToolError("nbs_list_projects", `List NBS projects failed: ${errorMessage(error)}`);
      }
    }
  );
}
