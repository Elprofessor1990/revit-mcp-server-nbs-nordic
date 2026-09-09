import { nbsClient } from "../NbsClient.js";
import { NbsQuantitiesPushInput } from "../NbsSchemas.js";

export async function pushQuantities(data: NbsQuantitiesPushInput): Promise<unknown> {
  // Live-verified 2026-09-09: registered only under /api/v1 (docs say V2 — wrong).
  return nbsClient.request(`/quantities`, {
    method: "POST",
    body: data,
    useV1: true,
  });
}
