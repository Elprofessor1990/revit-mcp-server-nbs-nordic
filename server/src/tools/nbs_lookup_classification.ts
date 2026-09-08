import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchCciClassification, getCciDataInfo } from "../integrations/nbs/classification/ClassificationLookup.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";

export function registerNbsLookupClassificationTool(server: McpServer) {
  server.tool(
    "nbs_lookup_classification",
    "Search a static CCI classification code reference (Region Syddanmark IKT-liste, 2023-07-12) by free text " +
      "to find candidate classificationcode/classificationserial values for nbs_create_component. " +
      "IMPORTANT: this is CCI-specific reference data, not fetched from NBS — NBS Nordic projects can use different " +
      "classification systems (BIM7AA, CCS, etc.). Call nbs_get_project first and only trust these results if the " +
      "project's classification_system_name is CCI-based. Never invent a code yourself; if nothing matches, say so.",
    {
      query: z.string().describe("Free-text search term, e.g. 'facadevæg' or 'vindue'."),
      limit: z.number().optional().default(10).describe("Maximum results to return."),
    },
    async (args) => {
      try {
        const results = searchCciClassification(args.query, args.limit);
        const info = getCciDataInfo();
        return rawToolResponse("nbs_lookup_classification", {
          query: args.query,
          matches: results,
          source: info.source,
          classificationSystemHint: info.classificationSystemHint,
        });
      } catch (error) {
        return rawToolError("nbs_lookup_classification", `Classification lookup failed: ${errorMessage(error)}`);
      }
    }
  );
}
