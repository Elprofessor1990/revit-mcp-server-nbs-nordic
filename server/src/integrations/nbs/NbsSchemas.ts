import { z } from "zod";

// Fields per the official /projects/[id]/component POST documentation.
// Live create 2026-09-09 (v1, project 10973, component 343153): name and
// classificationcode were applied and NBS assigned the next free
// classificationserial itself. discipline_id and measure_id were silently
// IGNORED (subject "-" / measure "" on the created row), so callers must not
// rely on them — set fag/målemetode in the NBS web UI afterwards.
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
