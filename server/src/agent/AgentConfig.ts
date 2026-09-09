import { homedir } from "os";
import { join } from "path";

export const DEFAULT_WORKFLOW_CACHE_MAX_ENTRIES = 500;
export const DEFAULT_WORKFLOW_CACHE_TTL_DAYS = 30;
export const DEFAULT_WORKFLOW_CACHE_MIN_SUCCESS_COUNT = 2;
export const DEFAULT_WORKFLOW_MAX_STEPS = 20;

export interface AgentConfig {
  enabled: boolean;
  workflowCachePath: string;
  auditLogPath: string;
  cache: {
    maxEntries: number;
    ttlDays: number;
    minSuccessCountForReuse: number;
    maxWorkflowSteps: number;
  };
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function readAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
  userHome = homedir()
): AgentConfig {
  return {
    enabled: TRUE_VALUES.has((env.REVIT_MCP_TOOL_AGENT_ENABLED ?? "").trim().toLowerCase()),
    workflowCachePath: join(userHome, ".mcp-revit", "workflow-cache.db"),
    auditLogPath: join(userHome, ".mcp-revit", "audit-log.db"),
    cache: {
      maxEntries: DEFAULT_WORKFLOW_CACHE_MAX_ENTRIES,
      ttlDays: DEFAULT_WORKFLOW_CACHE_TTL_DAYS,
      minSuccessCountForReuse: DEFAULT_WORKFLOW_CACHE_MIN_SUCCESS_COUNT,
      maxWorkflowSteps: DEFAULT_WORKFLOW_MAX_STEPS,
    },
  };
}
