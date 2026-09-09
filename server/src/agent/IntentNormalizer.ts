export type KnownIntent = "wall_height" | "create_schedule" | "rename_types" | "sync_classification";

export interface NormalizedIntent {
  kind: KnownIntent;
  signature: string;
  /** Transient input only: never copy these values into a cached plan. */
  bindings: Record<string, string | number>;
}

/** Deliberately narrow grammar: unsupported or compound requests require explicit planning. */
export function normalizeIntent(input: string): NormalizedIntent | undefined {
  const text = input.normalize("NFKC").trim().replace(/\s+/g, " ").replace(/[.!]$/, "");
  const height = /^(?:ændr højden på de valgte vægge til|change the height of (?:the )?selected walls to|set (?:the )?selected walls(?:'|’)? height to) (\d+(?:[.,]\d+)?) mm$/i.exec(text);
  if (height) {
    const heightMm = Number(height[1].replace(",", "."));
    if (!Number.isFinite(heightMm) || heightMm <= 0) return undefined;
    return { kind: "wall_height", signature: "wall.height.set.selection", bindings: { heightMm } };
  }
  if (/^(?:opret en schedule for vægge med type, instance, bygningsdelsnummer og areal|create a (?:wall schedule|schedule for walls) with type, instance, (?:building-part number|classification code) and area)$/i.test(text))
    return { kind: "create_schedule", signature: "wall.schedule.create", bindings: {} };
  const rename = /^(?:omdøb de valgte typer efter denne navnestandard:|rename (?:the )?selected types using this naming standard:) (.+)$/i.exec(text);
  if (rename)
    return { kind: "rename_types", signature: "type.rename.selection", bindings: { namingStandard: rename[1] } };
  const sync = /^(?:synkroniser bygningsdelsnummer (\S+) fra NBS til de valgte Revit-elementer|sync classification code (\S+) from NBS to (?:the )?selected Revit elements)$/i.exec(text);
  if (sync)
    return { kind: "sync_classification", signature: "nbs.classification.sync.selection", bindings: { sharedKey: sync[1] ?? sync[2] } };
  return undefined;
}
