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
  // Live-verified 2026-09-09: this route is only registered under /api/v1
  // (GET -> 405 Allow: POST). Under /api/v2 it is a plain 404 even though the
  // public docs list it as V2.
  return nbsClient.request<NbsComponent>(`/projects/${projectId}/component`, {
    method: "POST",
    body: data,
    useV1: true,
  });
}

/**
 * Pro-only per the API docs. Live probe 2026-09-09: this route returned 404 on BOTH
 * /api/v1 and /api/v2 (no Allow header), so it may not exist on the live server at
 * all. Kept only because it is documented; expect NOT_FOUND until NBS confirms it.
 */
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
