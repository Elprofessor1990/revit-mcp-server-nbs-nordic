import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface CciEntry {
  classificationserial: string;
  name: string;
}

export interface CciGroup {
  classificationcode: string;
  classificationname: string;
  entries: CciEntry[];
}

interface CciData {
  _source: string;
  _classification_system_hint: string;
  groups: CciGroup[];
}

let cached: CciData | null = null;

function loadData(): CciData {
  if (cached) return cached;
  const filePath = join(__dirname, "cci-hierarchy.json");
  cached = JSON.parse(readFileSync(filePath, "utf-8")) as CciData;
  return cached;
}

export interface CciMatch {
  classificationcode: string;
  classificationserial: string;
  classificationname: string;
  name: string;
  /** Full code as NBS would combine it, e.g. "[L]%AD.110". Verify the
   *  project's actual classificationcode_separator before relying on this
   *  exact format — "." is the common default but not guaranteed. */
  fullCode: string;
}

/**
 * Search the CCI reference data for entries whose name (or group name)
 * contains the given text (case-insensitive). This is a reference lookup
 * only — it does NOT verify the code is valid for any specific NBS project.
 * Callers must confirm the project's classification_system_name is
 * CCI-compatible via nbs_get_project before treating results as authoritative.
 */
export function searchCciClassification(query: string, limit = 10): CciMatch[] {
  const data = loadData();
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const results: CciMatch[] = [];
  for (const group of data.groups) {
    for (const entry of group.entries) {
      const haystack = `${group.classificationname} ${entry.name}`.toLowerCase();
      if (haystack.includes(needle)) {
        results.push({
          classificationcode: group.classificationcode,
          classificationserial: entry.classificationserial,
          classificationname: group.classificationname,
          name: entry.name,
          fullCode: `${group.classificationcode}.${entry.classificationserial}`,
        });
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}

/** Look up a group by its classificationcode (e.g. "[L]%AD"). */
export function getCciGroup(classificationcode: string): CciGroup | undefined {
  const data = loadData();
  return data.groups.find((g) => g.classificationcode === classificationcode);
}

/**
 * Detect a classificationcode that looks like a group code with a serial
 * concatenated onto it (e.g. "[L]%AD130" or "[L]%AD.130" instead of the
 * group-only "[L]%AD"). NBS's create endpoint does not reject these: it
 * silently truncates to the known group prefix and discards the digits,
 * so the caller's intended sub-type (e.g. "130" = Skalmuret vs "140" =
 * Skeletkonstruktion) is lost with no error (live-verified 2026-09-09,
 * project 13365: components 343271/343277/343278/343291 were all created
 * with classificationcode "[L]%AD" regardless of what was actually sent).
 * Only fires when stripping a trailing digit run yields a KNOWN CCI group,
 * so it never misfires on a genuinely different (non-CCI) classification
 * system's codes — for those this simply returns undefined and is a no-op.
 */
export function detectEmbeddedSerial(classificationcode: string): { groupCode: string; digits: string } | undefined {
  const data = loadData();
  if (data.groups.some((g) => g.classificationcode === classificationcode)) return undefined; // already a bare, known group code
  const m = /^(.*?)[.\-_]?(\d{2,})$/.exec(classificationcode.trim());
  if (!m) return undefined;
  const [, prefix, digits] = m;
  const group = data.groups.find((g) => g.classificationcode === prefix);
  return group ? { groupCode: group.classificationcode, digits } : undefined;
}

export function getCciDataInfo(): { source: string; classificationSystemHint: string; groupCount: number; entryCount: number } {
  const data = loadData();
  return {
    source: data._source,
    classificationSystemHint: data._classification_system_hint,
    groupCount: data.groups.length,
    entryCount: data.groups.reduce((sum, g) => sum + g.entries.length, 0),
  };
}
