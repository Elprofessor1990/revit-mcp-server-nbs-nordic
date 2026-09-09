import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pushQuantities } from "../integrations/nbs/quantities/QuantityService.js";
import { resolveNbsProjectId } from "../integrations/nbs/ProjectConnection.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";

export function registerNbsPushQuantitiesTool(server: McpServer) {
  server.tool(
    "nbs_push_quantities",
    "Push quantity rows to NBS Nordic (POST /quantities). " +
      "IMPORTANT: verify units before calling — Revit internal units are feet, NBS expects " +
      "m²/m³/m/pcs. Do not assume unit conversion is automatic; normalize on the caller side first.",
    {
      projectId: z
        .union([z.string(), z.number()])
        .optional()
        .describe("NBS database project ID. Omit to use the project connected to the active Revit model."),
      rows: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Quantity rows. Exact row shape is not fully documented by NBS — verify against a real response before relying on specific field names."),
    },
    async (args) => {
      try {
        const projectId = await resolveNbsProjectId(args.projectId);
        const result = await pushQuantities({ project_id: projectId, json_array: args.rows });
        return rawToolResponse("nbs_push_quantities", result);
      } catch (error) {
        return rawToolError("nbs_push_quantities", `Push NBS quantities failed: ${errorMessage(error)}`);
      }
    }
  );
}
