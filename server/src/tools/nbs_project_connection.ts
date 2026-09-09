import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getModelContext, connectProject, cloneProject } from "../integrations/nbs/ProjectConnection.js";
import { readModelSettings } from "../integrations/nbs/ModelSettings.js";
import { nbsClient } from "../integrations/nbs/NbsClient.js";
import type { NbsProject } from "../integrations/nbs/NbsTypes.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";
import { errorMessage } from "../utils/errorUtils.js";

export function registerNbsProjectConnectionTools(server: McpServer) {
  server.tool("get_connection_status", "Read connection status, active Revit model identity, NBS project, missing parameter bindings, and the sync defaults (link mode, fields) the user saved for this model in Revit Settings > NBS Nordic. Never returns API keys.", {}, async () => {
    const [revit, nbs] = await Promise.allSettled([getModelContext(), nbsClient.request<NbsProject[]>("/projects")]);
    const model = revit.status === "fulfilled" ? revit.value : undefined;
    const projects = nbs.status === "fulfilled" ? nbs.value : [];
    return rawToolResponse("get_connection_status", {
      revit: model ?? { connected: false, error: errorMessage(revit.status === "rejected" ? revit.reason : "Unknown error") },
      modelSyncSettings: model ? readModelSettings(model.modelKey) : null,
      nbs: nbs.status === "fulfilled" ? {
        connected: true, accessibleProjects: projects.length,
        project: projects.filter(p => String(p.id) === model?.projectId).map(p => ({ id: p.id, name: p.project_name, classification: p.classification_system_name }))[0] ?? null,
      } : { connected: false, error: errorMessage(nbs.reason) },
    });
  });
  server.tool("nbs_connect_project", "Connect the active Revit model to an accessible NBS project and create the official NBS type/instance parameter bindings in one operation. Saves the project ID in the model; save the RVT to persist. Repeated connection to the same project is safe. Will not silently migrate an already linked model to a different project.", {
    projectId: z.union([z.string(), z.number()]),
    expectedModelKey: z.string().optional().describe("Model identity returned by get_connection_status; prevents connecting a different active model."),
  }, async args => {
    try { return rawToolResponse("nbs_connect_project", await connectProject(args.projectId, args.expectedModelKey)); }
    catch (e) { return rawToolError("nbs_connect_project", errorMessage(e)); }
  });
  server.tool("nbs_clone_project", "Create a new NBS project by cloning an existing project and its setup (documented Pro feature). Not blank-project creation. Only call when the user requested a new project with this name/template. Does not connect the Revit model. On timeout, check nbs_list_projects before retrying to avoid duplicate projects.", {
    templateProjectId: z.union([z.string(), z.number()]),
    name: z.string().trim().min(1).max(200),
  }, async args => {
    try { return rawToolResponse("nbs_clone_project", await cloneProject(args.templateProjectId, args.name)); }
    catch (e) { return rawToolError("nbs_clone_project", errorMessage(e) + " Check the project list before retrying; creation may have completed."); }
  });
}
