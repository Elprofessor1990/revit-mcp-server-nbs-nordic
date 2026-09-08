import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const DEFAULT_BASE_URL = "https://nbsnordic.net/api/v2";

// The public docs confirm V1 document endpoints (/documents, /documents/[id],
// /projects/[id]/documents) exist but never state their base path explicitly.
// This is inferred from the v2 convention (same host, /api/v1 instead of
// /api/v2) — NOT independently verified. Override with NBS_V1_BASE_URL once
// confirmed against a live account.
const DEFAULT_V1_BASE_URL = "https://nbsnordic.net/api/v1";

export interface NbsConfig {
  apiKey: string;
  baseUrl: string;
  v1BaseUrl: string;
  defaultProjectId?: string;
}

// Matches the storage options offered by the plugin's NBS Nordic settings
// page (NbsApiKeySettingsPage.xaml): either an env var, or this file with
// the key on line 1 and an optional default project ID on line 2.
function getFileApiKeyPath(): string {
  return join(homedir(), ".claude", "nbs_api_key.txt");
}

function readFileConfig(): { apiKey?: string; projectId?: string } {
  const filePath = getFileApiKeyPath();
  if (!existsSync(filePath)) return {};
  try {
    const lines = readFileSync(filePath, "utf-8").split(/\r?\n/);
    return {
      apiKey: lines[0]?.trim() || undefined,
      projectId: lines[1]?.trim() || undefined,
    };
  } catch {
    return {};
  }
}

export function getNbsConfig(): NbsConfig {
  const fileConfig = readFileConfig();
  const apiKey = process.env.NBS_API_KEY || fileConfig.apiKey;
  if (!apiKey) {
    throw new Error(
      "NBS_API_KEY is not set. Configure it as an environment variable, or via the NBS Nordic settings page in the Revit plugin."
    );
  }
  return {
    apiKey,
    baseUrl: process.env.NBS_BASE_URL || DEFAULT_BASE_URL,
    v1BaseUrl: process.env.NBS_V1_BASE_URL || DEFAULT_V1_BASE_URL,
    defaultProjectId: process.env.NBS_PROJECT_ID || fileConfig.projectId,
  };
}

/**
 * Resolve the projectId to use for an nbs_* tool call: the explicit value
 * passed by the caller, else the configured default (env var or settings
 * file). Every nbs_* tool should call this instead of reading
 * process.env.NBS_PROJECT_ID directly, so the file-based storage option
 * from the plugin's settings page works consistently everywhere.
 */
export function resolveProjectId(explicit?: string | number): string | number | undefined {
  if (explicit !== undefined) return explicit;
  try {
    return getNbsConfig().defaultProjectId;
  } catch {
    // No API key configured either — let the caller's own error path handle it.
    return process.env.NBS_PROJECT_ID;
  }
}
