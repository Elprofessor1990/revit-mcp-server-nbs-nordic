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

/**
 * NBSLinkType code (official addin's "NBS Override" setting) → our link mode.
 * Verified live 2026-09-09 against addin 1.6.0 in Revit 2027: the addin's
 * Settings combobox lists "Type and Instance", "Type Only", "Instance Only", and
 * Revit's journal showed SelectItem(0) → NBSLinkType=0 and SelectItem(1) →
 * NBSLinkType=1 written to the model. Index 2 follows from the list order.
 * Keep in step with plugin/Core/NbsNativeSettings.cs LinkTypeCodes.
 */
export const NATIVE_LINK_TYPE_CODES: Readonly<Record<string, LinkMode>> = {
  "0": "typeAndInstance",
  "1": "typeOnly",
  "2": "instanceOnly",
};

/** Our link mode for a raw NBSLinkType value; undefined for absent or unknown codes. */
export function decodeNativeLinkType(code: string | null | undefined): LinkMode | undefined {
  if (typeof code !== "string") return undefined;
  return NATIVE_LINK_TYPE_CODES[code.trim()];
}

export type LinkModeSource = "call" | "modelSettings" | "nativeAddin";

/**
 * Link mode for one sync call: explicit argument, then the user's saved
 * per-model choice, then the official addin's own setting in the model.
 * Throws when none is available — a link mode is never guessed.
 */
export function resolveLinkMode(explicit: LinkMode | undefined, saved: ModelSyncSettings, nativeLinkType: string | null | undefined): { linkMode: LinkMode; source: LinkModeSource } {
  if (explicit) return { linkMode: explicit, source: "call" };
  if (saved.linkMode) return { linkMode: saved.linkMode, source: "modelSettings" };
  const native = decodeNativeLinkType(nativeLinkType);
  if (native) return { linkMode: native, source: "nativeAddin" };
  throw new Error("No link mode chosen. Pass linkMode (typeOnly / instanceOnly / typeAndInstance), save one for this model under Revit Settings > NBS Nordic > Synkronisering, or set Link Type in the NBS Nordic addin.");
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
