/** Reviewed subset of the frozen inventory used by the four v1 workflows.
 * No MCP imports, registration, discovery calls, or execution side effects.
 */
export const ROUTING_TOOL_IDS = Object.freeze([
  "get_selected_elements", "get_element_parameters", "set_element_parameters",
  "list_schedulable_fields", "create_schedule", "get_schedule_data",
  "batch_rename", "get_connection_status", "sync_revit_types_to_nbs",
] as const);

export class ToolCatalog {
  private readonly tools: ReadonlySet<string>;
  constructor(readonly fingerprint: string, toolIds: readonly string[]) {
    if (!fingerprint.trim()) throw new Error("A catalog fingerprint is required.");
    this.tools = new Set(toolIds);
  }
  has(toolId: string): boolean { return this.tools.has(toolId); }
}
