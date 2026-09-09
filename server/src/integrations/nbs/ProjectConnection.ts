import { withRevitConnection } from "../../utils/ConnectionManager.js";
import { nbsClient } from "./NbsClient.js";
import type { NbsProject } from "./NbsTypes.js";

export interface RevitNbsContext {
  modelKey: string;
  documentTitle: string;
  filePath: string;
  projectId: string | null;
  missingParameters: string[];
  parameterFileAvailable: boolean;
  isReadOnly: boolean;
  /** Raw NBSLinkType value from the official addin's "NBS Override" setting; decode with decodeNativeLinkType (mapping verified 2026-09-09). */
  nativeLinkType?: string | null;
  /** The plugin's own decoding of nativeLinkType; absent from older plugin builds. */
  nativeLinkMode?: string | null;
  nativeSettingsReady?: boolean;
}

export function validateProjectId(id: string | number): string {
  const value = String(id);
  if (!/^[1-9]\d*$/.test(value)) throw new Error("Use the numeric NBS database project ID returned by nbs_list_projects, not the project's display number.");
  return value;
}

export async function getModelContext(): Promise<RevitNbsContext> {
  try {
    return await withRevitConnection(c => c.sendCommand("nbs_project", { operation: "status" }), 35000);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found"))
      throw new Error("The running Revit plugin predates project connections. Install the updated plugin and restart Revit.");
    throw error;
  }
}

/** A model's persisted project wins; a machine-wide default must not route another model's writes. */
export async function resolveNbsProjectId(explicit?: string | number): Promise<string> {
  if (explicit !== undefined) return validateProjectId(explicit);
  const context = await getModelContext();
  if (!context.projectId) throw new Error("This Revit model is not connected to NBS. Use nbs_list_projects then nbs_connect_project once for this model.");
  return validateProjectId(context.projectId);
}

export async function connectProject(projectId: string | number, expectedModelKey?: string): Promise<RevitNbsContext> {
  const id = validateProjectId(projectId);
  const context = await getModelContext();
  if (expectedModelKey && context.modelKey !== expectedModelKey) throw new Error("The active Revit model changed. Check get_connection_status before connecting.");
  const project = await nbsClient.request<NbsProject>(`/projects/${id}`);
  if (String(project.id) !== id || project.active === 0) throw new Error("NBS did not return the requested active project.");
  return withRevitConnection(c => c.sendCommand("nbs_project", {
    operation: "connect", projectId: id, expectedModelKey: context.modelKey,
  }), 35000);
}

export async function cloneProject(templateProjectId: string | number, name: string): Promise<unknown> {
  const id = validateProjectId(templateProjectId);
  if (!name.trim()) throw new Error("A name for the new project is required.");
  // The documented API creates a copy, not a blank project. Never retry this POST automatically.
  return nbsClient.request(`/projects/${id}?project_name=${encodeURIComponent(name.trim())}`, { method: "POST" });
}
