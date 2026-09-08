import { nbsClient } from "../NbsClient.js";
import { NbsQuantitiesPushInput } from "../NbsSchemas.js";

export async function pushQuantities(data: NbsQuantitiesPushInput): Promise<unknown> {
  return nbsClient.request(`/quantities`, {
    method: "POST",
    body: data,
  });
}
