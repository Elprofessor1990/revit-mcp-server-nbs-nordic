import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createComponent } from "../integrations/nbs/components/ComponentService.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";

export function registerNbsCreateComponentTool(server: McpServer) {
  server.tool(
    "nbs_create_component",
    "Create a new NBS Nordic building component (bygningsdel) in a project. " +
      "Do not invent structure/description values — they must come from verified Revit " +
      "parameters, user input, or an approved knowledge source (see prepare_nbs_component_description).",
    {
      projectId: z
        .union([z.string(), z.number()])
        .optional()
        .describe("NBS project ID. Omit to use the NBS_PROJECT_ID environment variable."),
      name: z.string().describe("Component name"),
      structure: z.string().optional().describe("Layer/build-up description"),
      classificationcode: z.string().optional().describe("NBS classification code"),
      discipline_id: z.number().optional(),
      measure_id: z.number().optional(),
      active: z.union([z.literal(0), z.literal(1)]).optional().default(1),
      description: z.string().optional(),
    },
    async (args) => {
      try {
        const projectId = args.projectId ?? process.env.NBS_PROJECT_ID;
        if (!projectId) {
          return rawToolError("nbs_create_component", "No projectId provided and NBS_PROJECT_ID is not set.");
        }
        const { projectId: _omit, ...data } = args;
        const component = await createComponent(projectId, data);
        return rawToolResponse("nbs_create_component", component);
      } catch (error) {
        return rawToolError("nbs_create_component", `Create NBS component failed: ${errorMessage(error)}`);
      }
    }
  );
}
