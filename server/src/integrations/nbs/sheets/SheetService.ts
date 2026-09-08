import { nbsClient } from "../NbsClient.js";
import { NbsSheetPushInput } from "../NbsSchemas.js";

export async function pushSheet(data: NbsSheetPushInput): Promise<unknown> {
  return nbsClient.request(`/sheet`, {
    method: "POST",
    body: data,
  });
}
