import type { NbsComponent, NbsProject } from "../NbsTypes.js";
import { matchType, type NbsComponentLite } from "./TypeMatcher.js";

export interface SyncElement {
  uniqueId: string;
  parameters: Record<string, string | null>;
}
export interface SyncSnapshot {
  modelKey: string;
  projectId: string | null;
  types: (SyncElement & { typeId: number; typeName: string; familyName: string })[];
  instances: (SyncElement & { id: number; typeId: number })[];
}
export interface ParameterWrite {
  uniqueId: string;
  parameterName: string;
  previousValue: string;
  value: string;
}

export type LinkMode = "typeOnly" | "instanceOnly" | "typeAndInstance";
export interface SyncOptions {
  linkMode?: LinkMode;
  explicitInstanceMapping?: Record<string, number>;
  inheritTypeForUnlinkedInstances?: boolean;
}

export function fullClassification(component: NbsComponent, project: Pick<NbsProject, "classificationcode_separator">): string {
  const code = component.classificationcode?.trim() ?? "";
  const serial = component.classificationserial?.trim() ?? "";
  if (!code || !serial) return code;
  const separator = component.classificationcode_separator ?? project.classificationcode_separator;
  if (separator === undefined) throw new Error("NBS did not supply the classification separator; refusing to guess a classification code.");
  return code + separator + serial;
}

export function buildSyncPlan(snapshot: SyncSnapshot, components: NbsComponent[], project: NbsProject, explicitMapping?: Record<string, number>, options: SyncOptions = {}) {
  if (snapshot.projectId !== String(project.id)) throw new Error("The model is not linked to the requested NBS project.");
  const linkMode = options.linkMode ?? "typeAndInstance";
  if (!["typeOnly", "instanceOnly", "typeAndInstance"].includes(linkMode)) throw new Error("Unknown link mode.");
  const includeTypes = linkMode !== "instanceOnly";
  const includeInstances = linkMode !== "typeOnly";
  if (!includeTypes && Object.keys(explicitMapping ?? {}).length) throw new Error("Type mappings cannot be used in Instance Only mode.");
  if (!includeInstances && Object.keys(options.explicitInstanceMapping ?? {}).length) throw new Error("Instance mappings cannot be used in Type Only mode.");
  if (options.inheritTypeForUnlinkedInstances && linkMode !== "typeAndInstance") throw new Error("Type inheritance requires Type and Instance mode.");
  const usable = components.filter((c): c is NbsComponent & { id: number } => c.id != null && c.active !== 0 && c.active !== false);
  const byId = new Map(usable.map(c => [c.id, c]));
  for (const [id, componentId] of Object.entries(explicitMapping ?? {})) {
    if (!snapshot.types.some(t => String(t.typeId) === id) || !byId.has(componentId)) throw new Error("Type mapping references an unknown type or inactive/unknown NBS component.");
  }
  for (const [uniqueId, componentId] of Object.entries(options.explicitInstanceMapping ?? {})) {
    if (!snapshot.instances.some(i => i.uniqueId === uniqueId) || !byId.has(componentId)) throw new Error("Instance mapping references an unknown instance or inactive/unknown NBS component.");
  }
  const candidates: NbsComponentLite[] = usable.map(c => ({ id: c.id, name: c.name, classificationcode: fullClassification(c, project) }));
  const requests: ParameterWrite[] = [];
  const updatedTypes: number[] = [];
  const updatedInstances: number[] = [];
  const append = (element: SyncElement, instance: boolean, component: NbsComponent & { id: number }) => {
    const before = requests.length;
    const prefix = instance ? "NBS Instance " : "NBS ";
    const desired: Record<string, string> = {
      [instance ? "NBS Component Instance Id" : "NBS Component Type Id"]: String(component.id),
      [prefix + "Classificationcode"]: fullClassification(component, project),
      [prefix + "Component Name"]: component.name,
    };
    if (component.updated_at) desired[prefix + "Date"] = component.updated_at;
    const urls = component.published_document_urls?.filter(u => {
      try { const url = new URL(u); return url.protocol === "https:" && (url.hostname === "nbsnordic.net" || url.hostname.endsWith(".nbsnordic.net")); }
      catch { return false; }
    });
    if (urls !== undefined) desired[prefix + "Doc Link"] = urls.join(", ");
    for (const [parameterName, value] of Object.entries(desired)) {
      const previousValue = element.parameters[parameterName] ?? "";
      if (previousValue !== value) requests.push({ uniqueId: element.uniqueId, parameterName, previousValue, value });
    }
    return requests.length > before;
  };
  const rows = snapshot.types.map(type => {
    const match = matchType({
      typeId: type.typeId, typeName: type.typeName, familyName: type.familyName,
      existingNbsComponentId: type.parameters["NBS Component Type Id"] ?? undefined,
      existingClassificationcode: type.parameters["NBS Classificationcode"] ?? undefined,
    }, candidates, explicitMapping);
    const instances = snapshot.instances.filter(i => i.typeId === type.typeId);
    if (includeTypes && match.component && match.confidence >= 0.9 && !match.ambiguous) {
      if (append(type, false, byId.get(match.component.id)!)) updatedTypes.push(type.typeId);
    }
    return { typeId: type.typeId, typeName: type.typeName, familyName: type.familyName, instanceCount: instances.length, inScope: includeTypes, match };
  });
  const instanceRows = includeInstances ? snapshot.instances.map(instance => {
    const existingId = instance.parameters["NBS Component Instance Id"]?.trim();
    const existingCode = instance.parameters["NBS Instance Classificationcode"]?.trim();
    const mappedId = options.explicitInstanceMapping?.[instance.uniqueId];
    // A supplied mapping must never appear successful while a different old ID wins.
    if (mappedId !== undefined && existingId && existingId !== String(mappedId))
      throw new Error("Instance already links to a different NBS component; explicit unlink/migration is required.");
    let match = matchType({ typeId: instance.id, typeName: "", familyName: "",
      existingNbsComponentId: existingId, existingClassificationcode: existingCode,
    }, candidates, mappedId === undefined ? undefined : { [String(instance.id)]: mappedId });
    let inheritedFromType = false;
    if (options.inheritTypeForUnlinkedInstances && !existingId && !existingCode && mappedId === undefined) {
      const typeMatch = rows.find(t => t.typeId === instance.typeId)?.match;
      if (typeMatch?.component && typeMatch.confidence >= 0.9 && !typeMatch.ambiguous) {
        match = typeMatch;
        inheritedFromType = true;
      }
    }
    if (match.component && match.confidence >= 0.9 && !match.ambiguous) {
      if (append(instance, true, byId.get(match.component.id)!)) updatedInstances.push(instance.id);
    }
    return { id: instance.id, uniqueId: instance.uniqueId, typeId: instance.typeId, inheritedFromType, match };
  }) : [];
  return { linkMode, rows, instanceRows, requests, updatedTypes, updatedInstances };
}
