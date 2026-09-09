import { nbsClient } from "../NbsClient.js";
import { NbsSheetPushInput } from "../NbsSchemas.js";

export async function pushSheet(data: NbsSheetPushInput): Promise<unknown> {
  // Live-verified 2026-09-09: registered only under /api/v1 (docs say V2 — wrong).
  return nbsClient.request(`/sheet`, {
    method: "POST",
    body: data,
    useV1: true,
  });
}
