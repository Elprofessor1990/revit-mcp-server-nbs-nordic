import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { LinkMode } from "./matching/SyncPlanner.js";

/** NBS fields the sync may write, in the order the settings page shows them. */
export const NBS_SYNC_FIELDS = ["id", "classificationcode", "name", "date", "docLink"] as const;
export type SyncField = (typeof NBS_SYNC_FIELDS)[number];

export const LINK_MODES: readonly LinkMode[] = ["typeOnly", "instanceOnly", "typeAndInstance"];

export interface ModelSyncSettings {
  linkMode?: LinkMode;
  fields?: SyncField[];
}

export function defaultConfigPath(): string {
  return join(homedir(), ".mcp-revit", "nbs-config.json");
}

/**
 * Per-model sync defaults saved by Revit Settings > NBS Nordic under
 * `models[modelKey]`. Read on every call (the page writes the file atomically)
 * so a change in Revit takes effect without restarting the AI client.
 * Anything missing or malformed is treated as "not set" — never as a guess.
 */
export function readModelSettings(modelKey: string, configPath = defaultConfigPath()): ModelSyncSettings {
  if (!modelKey || !existsSync(configPath)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    // The file also holds the API key; never surface parser output.
    return {};
  }
  const models = (raw as { models?: Record<string, unknown> } | null)?.models;
  const entry = models && typeof models === "object" ? (models as Record<string, unknown>)[modelKey] : undefined;
  if (!entry || typeof entry !== "object") return {};
  const { linkMode, fields } = entry as { linkMode?: unknown; fields?: unknown };
  const result: ModelSyncSettings = {};
  if (typeof linkMode === "string" && (LINK_MODES as readonly string[]).includes(linkMode)) result.linkMode = linkMode as LinkMode;
  if (Array.isArray(fields)) {
    const valid = fields.filter((f): f is SyncField => typeof f === "string" && (NBS_SYNC_FIELDS as readonly string[]).includes(f));
    if (valid.length === fields.length) result.fields = [...new Set(valid)];
  }
  return result;
}
