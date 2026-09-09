import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createComponent } from "../integrations/nbs/components/ComponentService.js";
import { detectEmbeddedSerial } from "../integrations/nbs/classification/ClassificationLookup.js";
import { resolveNbsProjectId } from "../integrations/nbs/ProjectConnection.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";

export function registerNbsCreateComponentTool(server: McpServer) {
  server.tool(
    "nbs_create_component",
    "Create a new NBS Nordic building component (bygningsdel) in a project. " +
      "Do not invent structure/description values — they must come from verified Revit " +
      "parameters, user input, or an approved knowledge source (see prepare_nbs_component_description). " +
      "classificationcode must be the bare GROUP code (e.g. '[L]%AD'), never a full code with a serial " +
      "appended (e.g. NOT '[L]%AD130' or '[L]%AD.130'): NBS's create endpoint does not reject a full " +
      "code, it silently truncates to the group prefix and discards the serial digits (live-verified " +
      "2026-09-09), so the sub-type distinction (e.g. Skalmuret vs. Skeletkonstruktion) is lost with no " +
      "error. classificationserial cannot be set on create; NBS assigns it internally, and that " +
      "assignment is not reliably unique (live-verified duplicates) — check the returned serial and fix " +
      "duplicates by hand in the NBS web UI if needed. There is also no update or delete route.",
    {
      projectId: z
        .union([z.string(), z.number()])
        .optional()
        .describe("NBS database project ID. Omit to use the project connected to the active Revit model."),
      name: z.string().describe("Component name"),
      structure: z.string().optional().describe("Layer/build-up description"),
      classificationcode: z
        .string()
        .optional()
        .describe("NBS classification GROUP code only, e.g. '[L]%AD' — never a full code with a serial appended (e.g. not '[L]%AD130' or '[L]%AD.130'); NBS silently drops the serial and keeps only the group prefix. classificationserial cannot be set here."),
      discipline_id: z.number().optional(),
      measure_id: z.number().optional(),
      active: z.union([z.literal(0), z.literal(1)]).optional().default(1),
      description: z.string().optional(),
    },
    async (args) => {
      try {
        if (args.classificationcode) {
          const embedded = detectEmbeddedSerial(args.classificationcode);
          if (embedded) {
            return rawToolError(
              "nbs_create_component",
              `classificationcode "${args.classificationcode}" looks like the group code "${embedded.groupCode}" with a serial ("${embedded.digits}") appended. ` +
                `NBS's create endpoint silently discards the serial and keeps only "${embedded.groupCode}" — no error, no data loss warning, just a wrong result. ` +
                `Pass classificationcode: "${embedded.groupCode}" instead (bare group code); classificationserial cannot be set on create, NBS assigns it internally. No component was created.`
            );
          }
        }
        const projectId = await resolveNbsProjectId(args.projectId);
        const { projectId: _omit, ...data } = args;
        const component = await createComponent(projectId, data);
        return rawToolResponse("nbs_create_component", component);
      } catch (error) {
        return rawToolError("nbs_create_component", `Create NBS component failed: ${errorMessage(error)}`);
      }
    }
  );
}
