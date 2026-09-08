import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { documentService } from "../integrations/nbs/documents/DocumentService.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";

export function registerNbsGetDocumentsTool(server: McpServer) {
  server.tool(
    "nbs_get_documents",
    "List NBS Nordic documents (all projects, or one project if projectId is given), or fetch a single " +
      "document by ID. Read-only — NBS has no public API for creating/editing documents or sections; " +
      "that remains a manual step in the NBS web UI.\n" +
      "Note: uses the V1 API base path, which is inferred from NBS' documented v1/v2 versioning convention " +
      "but not independently confirmed — verify against a live account if results look wrong.",
    {
      projectId: z
        .union([z.string(), z.number()])
        .optional()
        .describe("List documents for this project only. Omit to list documents across all your projects."),
      documentId: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Fetch a single document by ID instead of listing."),
    },
    async (args) => {
      try {
        if (args.documentId) {
          const doc = await documentService.getDocument(args.documentId);
          return rawToolResponse("nbs_get_documents", doc);
        }
        const docs = await documentService.listDocuments(args.projectId);
        return rawToolResponse("nbs_get_documents", docs);
      } catch (error) {
        return rawToolError("nbs_get_documents", `Get NBS documents failed: ${errorMessage(error)}`);
      }
    }
  );
}
