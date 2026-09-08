// Pure matching logic — no I/O. Priority order per the project plan:
// 1. NBS Component ID already stored on the Revit type
// 2. classificationcode
// 3. explicit mapping (config file)
// 4. exact normalized component name
// 5. family + typeName (fuzzy — proposal only, never auto-applied)

export interface RevitTypeInfo {
  typeId: number;
  familyName: string;
  typeName: string;
  existingNbsComponentId?: string;
  existingClassificationcode?: string;
}

export interface NbsComponentLite {
  id: number;
  name: string;
  classificationcode?: string;
}

export type MatchMethod = "id" | "classificationcode" | "explicit" | "name" | "family_type" | "none";

export interface MatchResult {
  method: MatchMethod;
  component?: NbsComponentLite;
  confidence: number; // 0..1 — only "id"/"explicit" (1.0) should ever be auto-applied
  ambiguous: boolean;
  candidates?: NbsComponentLite[];
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function matchType(
  revitType: RevitTypeInfo,
  nbsComponents: NbsComponentLite[],
  explicitMapping?: Record<string, number>
): MatchResult {
  if (revitType.existingNbsComponentId) {
    const component = nbsComponents.find((c) => String(c.id) === revitType.existingNbsComponentId);
    if (component) return { method: "id", component, confidence: 1, ambiguous: false };
  }

  if (revitType.existingClassificationcode) {
    const matches = nbsComponents.filter((c) => c.classificationcode === revitType.existingClassificationcode);
    if (matches.length === 1) return { method: "classificationcode", component: matches[0], confidence: 0.9, ambiguous: false };
    if (matches.length > 1) return { method: "classificationcode", confidence: 0.5, ambiguous: true, candidates: matches };
  }

  if (explicitMapping) {
    const mappedId = explicitMapping[String(revitType.typeId)];
    if (mappedId != null) {
      const component = nbsComponents.find((c) => c.id === mappedId);
      if (component) return { method: "explicit", component, confidence: 1, ambiguous: false };
    }
  }

  const normalizedTypeName = normalizeName(revitType.typeName);
  const nameMatches = nbsComponents.filter((c) => normalizeName(c.name) === normalizedTypeName);
  if (nameMatches.length === 1) return { method: "name", component: nameMatches[0], confidence: 0.7, ambiguous: false };
  if (nameMatches.length > 1) return { method: "name", confidence: 0.4, ambiguous: true, candidates: nameMatches };

  const combined = normalizeName(`${revitType.familyName} ${revitType.typeName}`);
  const fuzzy = nbsComponents.filter((c) => {
    const n = normalizeName(c.name);
    return n.includes(combined) || combined.includes(n);
  });
  if (fuzzy.length > 0) return { method: "family_type", confidence: 0.3, ambiguous: fuzzy.length > 1, candidates: fuzzy };

  return { method: "none", confidence: 0, ambiguous: false };
}
