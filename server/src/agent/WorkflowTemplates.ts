import type { KnownIntent } from "./IntentNormalizer.js";
import type { WorkflowStep } from "./types.js";

/** Bindings are descriptions for a future orchestrator, not executable MCP arguments.
 * Validation/read-back phases carry obligations, not a claim that they have run.
 */
export function workflowSteps(kind: KnownIntent): WorkflowStep[] {
  const step = (toolId: string, phase: WorkflowStep["phase"], argsTemplate: Record<string, unknown>): WorkflowStep =>
    ({ toolId, phase, argsTemplate });
  const selected = () => step("get_selected_elements", "read", {});
  const parameters = (phase: "validate" | "verify", elementIds = "$selectedElementIds") =>
    step("get_element_parameters", phase, { elementIds, includeTypeParameters: true });
  switch (kind) {
    case "wall_height": return [selected(), parameters("validate"),
      step("set_element_parameters", "write", { requests: "$validatedHeightRequests" }), parameters("verify")];
    case "create_schedule": return [
      step("list_schedulable_fields", "validate", { categoryName: "OST_Walls", scheduleType: "regular" }),
      step("create_schedule", "write", { categoryName: "OST_Walls", fields: "$validatedScheduleFields", name: "$scheduleName" }),
      step("get_schedule_data", "verify", { scheduleId: "$createdScheduleId" })];
    case "rename_types": return [selected(), parameters("validate", "$uniqueSelectedTypeIds"),
      step("batch_rename", "validate", { elementIds: "$uniqueSelectedTypeIds", findText: "$findText", replaceText: "$replaceText", prefix: "$prefix", suffix: "$suffix", dryRun: true }),
      step("batch_rename", "write", { elementIds: "$uniqueSelectedTypeIds", findText: "$findText", replaceText: "$replaceText", prefix: "$prefix", suffix: "$suffix", dryRun: false }),
      parameters("verify", "$uniqueSelectedTypeIds")];
    case "sync_classification": return [
      step("get_connection_status", "read", {}),
      step("sync_revit_types_to_nbs", "validate", { category: "$validatedCategory", projectId: "$expectedProjectId", linkMode: "typeAndInstance", fields: ["classificationcode"], dryRun: true }),
      // One atomic write step; this tool owns allow-listed NBS writes and verification.
      step("sync_revit_types_to_nbs", "write", { category: "$validatedCategory", projectId: "$expectedProjectId", linkMode: "typeAndInstance", fields: ["classificationcode"], dryRun: false })];
  }
}

export const SIGNATURES: Readonly<Record<KnownIntent, string>> = Object.freeze({
  wall_height: "wall.height.set.selection", create_schedule: "wall.schedule.create",
  rename_types: "type.rename.selection", sync_classification: "nbs.classification.sync.selection",
});

/** These are execution preconditions for later steps, not implemented execution. */
export function obligations(kind: KnownIntent): string[] {
  const common = ["confirm_before_write", "read_live_data_before_write", "log_all_writes", "verify_requested_outcome"];
  switch (kind) {
    case "wall_height": return [...common, "require_complete_wall_selection", "validate_editability_and_height_constraints", "convert_mm_using_parameter_units"];
    case "create_schedule": return [...common, "resolve_type_instance_classification_and_area_fields", "prevent_duplicate_schedule"];
    case "rename_types": return [...common, "derive_unique_type_ids_from_complete_selection", "reject_unsupported_naming_rules", "validate_name_collisions_and_type_wide_impact"];
    case "sync_classification": return [...common, "same_model_and_project_at_preview_and_write", "only_existing_RequiredNames_parameters", "resolve_shared_key_from_live_nbs", "preserve_independent_instance_links", "require_both_type_and_instance_match", "reject_selection_scope_expansion"];
  }
}
