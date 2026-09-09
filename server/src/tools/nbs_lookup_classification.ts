import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchCciClassification, getCciDataInfo } from "../integrations/nbs/classification/ClassificationLookup.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";

export function registerNbsLookupClassificationTool(server: McpServer) {
  server.tool(
    "nbs_lookup_classification",
    "Search a static CCI classification code reference (Region Syddanmark IKT-liste, 2023-07-12) by free text " +
      "to find a candidate classificationcode for nbs_create_component. " +
      "IMPORTANT: nbs_create_component only accepts the GROUP-level classificationcode (the 'classificationcode' " +
      "field in each match, e.g. '[L]%AD') — never pass fullCode or a code with classificationserial appended " +
      "(e.g. '[L]%AD.130' or '[L]%AD130'); NBS's create endpoint silently discards the serial and any sub-type " +
      "distinction it encoded (live-verified 2026-09-09). classificationserial cannot be set on create at all — " +
      "NBS assigns it internally when the component is created, and that assignment is not guaranteed unique. " +
      "fullCode/classificationserial in each match are for READING existing data (matching or displaying an " +
      "already-created component's full code), not for creating one. " +
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
