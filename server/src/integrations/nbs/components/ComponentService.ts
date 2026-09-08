import { nbsClient } from "../NbsClient.js";
import { NbsComponent, NbsComponentsListResponse } from "../NbsTypes.js";
import { NbsComponentCreateInput } from "../NbsSchemas.js";

export async function listComponents(projectId: string | number): Promise<NbsComponent[]> {
  const response = await nbsClient.request<NbsComponentsListResponse>(`/projects/${projectId}/components`);
  return response.components;
}

export async function createComponent(
  projectId: string | number,
  data: NbsComponentCreateInput
): Promise<NbsComponent> {
  return nbsClient.request<NbsComponent>(`/projects/${projectId}/component`, {
    method: "POST",
    body: data,
  });
}

/** Pro-only per the API docs — not load-bearing tested for write access, only export-backup was. */
export async function setComponentExtraField(
  projectId: string | number,
  extraFieldId: string | number,
  componentId: string | number,
  value: unknown
): Promise<unknown> {
  return nbsClient.request(`/projects/${projectId}/component/${extraFieldId}`, {
    method: "POST",
    body: { component_id: componentId, value },
  });
}
