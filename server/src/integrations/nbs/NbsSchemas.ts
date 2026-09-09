import { z } from "zod";

// Fields per the official /projects/[id]/component POST documentation.
// Live creates 2026-09-09 (v1, project 10973): name and classificationcode are
// applied. classificationserial is NOT controllable: the first create got .003,
// but the next four (343221-343224, seconds apart) ALL got .004, an explicit
// classificationserial in the body was ignored, a full code "[L]%AD.005" was
// rejected silently (200, empty body, nothing created), and no update/delete
// route exists (v1/v2 PATCH/PUT/DELETE -> 404; v2 POST /components/{id} answers
// "success" to any body without changing the row). Duplicate serials must be
// fixed by hand in the NBS web UI. discipline_id and measure_id are silently
// IGNORED (subject "-" / measure "" on the created row) — set fag/målemetode in
// the NBS web UI afterwards. See docs/nbs-component-serial-2026-09-09.md.
export const NbsComponentCreateSchema = z.object({
  name: z.string(),
  structure: z.string().optional(),
  classificationcode: z.string().optional(),
  discipline_id: z.number().optional(),
  measure_id: z.number().optional(),
  active: z.union([z.literal(0), z.literal(1)]).optional(),
  description: z.string().optional(),
});
export type NbsComponentCreateInput = z.infer<typeof NbsComponentCreateSchema>;

// The exact row shape inside json_array for /sheet and /quantities is not
// documented beyond "an array of objects" — kept intentionally loose.
// Verify the real shape against a live response before relying on strict
// field names here.
export const NbsSheetPushSchema = z.object({
  name: z.string(),
  revit_id: z.string(),
  project_id: z.union([z.string(), z.number()]),
  json_array: z.array(z.record(z.string(), z.unknown())),
});
export type NbsSheetPushInput = z.infer<typeof NbsSheetPushSchema>;

export const NbsQuantitiesPushSchema = z.object({
  project_id: z.union([z.string(), z.number()]),
  json_array: z.array(z.record(z.string(), z.unknown())),
});
export type NbsQuantitiesPushInput = z.infer<typeof NbsQuantitiesPushSchema>;
