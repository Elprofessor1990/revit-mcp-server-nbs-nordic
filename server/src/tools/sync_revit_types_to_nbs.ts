import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withRevitConnection } from "../utils/ConnectionManager.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";
import { listComponents } from "../integrations/nbs/components/ComponentService.js";
import { resolveProjectId } from "../integrations/nbs/NbsConfig.js";
import { matchType, RevitTypeInfo, NbsComponentLite, MatchResult } from "../integrations/nbs/matching/TypeMatcher.js";
import { dbRun } from "../database/db.js";

// Field names below are taken directly from the C# models in commandset/ —
// not guessed. ElementInstanceInfo/FamilyTypeInfo have no [JsonProperty]
// override so they serialize as PascalCase; ElementParametersResult/
// SetParameterRequest/Result use explicit [JsonProperty] camelCase.

interface RevitAIResult<T> {
  Success: boolean;
  Message: string;
  Response: T;
}

interface RevitElementInstanceInfo {
  Id: number;
  UniqueId: string;
  TypeId: number;
  Name: string;
  FamilyName: string;
  Category: string;
}

interface RevitFamilyTypeInfo {
  FamilyTypeId: number;
  UniqueId: string;
  FamilyName: string;
  TypeName: string;
  Category: string;
}

interface RevitParamData {
  name: string;
  value: unknown;
  storageType: string;
  isReadOnly: boolean;
  isShared: boolean;
  groupName: string;
  hasValue: boolean;
}

interface RevitElementParametersResult {
  elementId: number;
  elementName: string;
  category: string;
  parameters: RevitParamData[];
}

const NBS_TYPE_ID_PARAM = "NBS Component Type Id";
const NBS_CLASSIFICATIONCODE_PARAM = "NBS Classificationcode";
const NBS_COMPONENT_NAME_PARAM = "NBS Component Name";

// Only these match methods/confidence levels are ever written back to Revit
// automatically. Name/fuzzy matches stay proposals — never auto-applied.
const AUTO_WRITE_MIN_CONFIDENCE = 0.9;

interface TypeMatchRow {
  typeId: number;
  familyName: string;
  typeName: string;
  instanceCount: number;
  match: MatchResult;
}

export function registerSyncRevitTypesToNbsTool(server: McpServer) {
  server.tool(
    "sync_revit_types_to_nbs",
    "Match Revit types in a category against NBS Nordic components, then (unless dryRun) write high-confidence " +
      "matches back to Revit type parameters (NBS Component Type Id / NBS Classificationcode / NBS Component Name). " +
      "Groups by Revit TYPE, not instance — 400 walls of 4 types produces 4 matches, not 400. " +
      "Only id/explicit/unique-classificationcode matches (confidence >= 0.9) are ever auto-written; " +
      "name and fuzzy family+type matches are returned as proposals only. " +
      "Does NOT create missing NBS components — review proposedCreates and call nbs_create_component explicitly " +
      "per type you approve. dryRun defaults to true.",
    {
      category: z.string().describe("Revit BuiltInCategory name, e.g. 'OST_Walls', 'OST_Doors'."),
      projectId: z
        .union([z.string(), z.number()])
        .optional()
        .describe("NBS project ID. Omit to use the NBS_PROJECT_ID environment variable."),
      maxTypes: z.number().optional().default(50).describe("Maximum distinct Revit types to process."),
      dryRun: z.boolean().optional().default(true).describe("If true (default), only report — no Revit writes happen."),
    },
    async (args) => {
      try {
        const projectId = resolveProjectId(args.projectId);
        if (!projectId) {
          return rawToolError("sync_revit_types_to_nbs", "No projectId provided and NBS_PROJECT_ID is not set.");
        }

        // 1. Gather Revit instances, types, and each type's existing NBS link
        // parameters in a single connection (three sequential commands) —
        // avoids paying a separate TCP connect/mutex-wait cycle per command.
        const { instances, familyTypes, existingParams } = await withRevitConnection(async (revitClient) => {
          const filterResult = (await revitClient.sendCommand("ai_element_filter", {
            filterCategory: args.category,
            includeInstances: true,
            includeTypes: false,
            maxElements: Math.min(args.maxTypes * 50, 1000),
          })) as RevitAIResult<RevitElementInstanceInfo[]>;

          const types = (await revitClient.sendCommand("get_available_family_types", {
            categoryList: [args.category],
            limit: args.maxTypes,
          })) as RevitFamilyTypeInfo[];

          const uniqueTypeIds = [...new Set((types ?? []).map((t) => t.FamilyTypeId))];
          let params: RevitElementParametersResult[] = [];
          if (uniqueTypeIds.length > 0) {
            const result = (await revitClient.sendCommand("get_element_parameters", {
              elementIds: uniqueTypeIds,
              includeTypeParameters: true,
            })) as RevitAIResult<RevitElementParametersResult[]>;
            params = result.Response ?? [];
          }

          return { instances: filterResult.Response ?? [], familyTypes: types ?? [], existingParams: params };
        }, 120000);

        if (familyTypes.length === 0) {
          return rawToolResponse("sync_revit_types_to_nbs", {
            instances: instances.length,
            uniqueTypes: 0,
            message: `No family types found for category '${args.category}'.`,
          });
        }

        // 2. Instance count per type.
        const countByTypeId = new Map<number, number>();
        for (const inst of instances) {
          countByTypeId.set(inst.TypeId, (countByTypeId.get(inst.TypeId) ?? 0) + 1);
        }

        function findParam(elementId: number, name: string): string | undefined {
          const entry = existingParams.find((e) => e.elementId === elementId);
          const param = entry?.parameters.find((p) => p.name === name);
          return param?.hasValue ? String(param.value) : undefined;
        }

        // 4. NBS components for matching.
        const nbsComponents = await listComponents(projectId);
        const nbsComponentsLite: NbsComponentLite[] = nbsComponents
          .filter((c) => c.id != null)
          .map((c) => ({ id: c.id as number, name: c.name, classificationcode: c.classificationcode }));

        // 5. Match every type.
        const rows: TypeMatchRow[] = familyTypes.map((t) => {
          const revitType: RevitTypeInfo = {
            typeId: t.FamilyTypeId,
            familyName: t.FamilyName,
            typeName: t.TypeName,
            existingNbsComponentId: findParam(t.FamilyTypeId, NBS_TYPE_ID_PARAM),
            existingClassificationcode: findParam(t.FamilyTypeId, NBS_CLASSIFICATIONCODE_PARAM),
          };
          return {
            typeId: t.FamilyTypeId,
            familyName: t.FamilyName,
            typeName: t.TypeName,
            instanceCount: countByTypeId.get(t.FamilyTypeId) ?? 0,
            match: matchType(revitType, nbsComponentsLite),
          };
        });

        const alreadyLinked = rows.filter((r) => r.match.method === "id").length;
        const autoWritable = rows.filter(
          (r) => r.match.method !== "id" && r.match.component && r.match.confidence >= AUTO_WRITE_MIN_CONFIDENCE && !r.match.ambiguous
        );
        const missing = rows.filter((r) => r.match.method === "none");
        const ambiguous = rows.filter((r) => r.match.ambiguous);
        const proposals = rows.filter(
          (r) => r.match.component && r.match.confidence < AUTO_WRITE_MIN_CONFIDENCE && !r.match.ambiguous
        );

        const summary = {
          category: args.category,
          instances: instances.length,
          uniqueTypes: familyTypes.length,
          alreadyLinked,
          exactMatches: autoWritable.length,
          missing: missing.length,
          ambiguous: ambiguous.length,
          dryRun: args.dryRun,
          proposedCreates: missing.map((r) => ({
            typeId: r.typeId,
            familyName: r.familyName,
            typeName: r.typeName,
            instanceCount: r.instanceCount,
          })),
          nameMatchProposals: proposals.map((r) => ({
            typeId: r.typeId,
            typeName: r.typeName,
            candidateComponent: r.match.component,
            method: r.match.method,
            confidence: r.match.confidence,
          })),
          ambiguousMatches: ambiguous.map((r) => ({
            typeId: r.typeId,
            typeName: r.typeName,
            candidates: r.match.candidates,
            method: r.match.method,
          })),
        };

        if (args.dryRun) {
          return rawToolResponse("sync_revit_types_to_nbs", summary);
        }

        // 6. Write auto-writable matches back to Revit. Never creates NBS
        // components and never writes ambiguous/fuzzy/name-only matches.
        const writeRequests: { elementId: number; parameterName: string; value: string }[] = [];
        const now = Date.now();

        for (const r of autoWritable) {
          const component = r.match.component!;
          writeRequests.push(
            { elementId: r.typeId, parameterName: NBS_TYPE_ID_PARAM, value: String(component.id) },
            { elementId: r.typeId, parameterName: NBS_COMPONENT_NAME_PARAM, value: component.name }
          );
          if (component.classificationcode) {
            writeRequests.push({ elementId: r.typeId, parameterName: NBS_CLASSIFICATIONCODE_PARAM, value: component.classificationcode });
          }

          dbRun(
            `INSERT INTO nbs_type_mappings (revit_type_id, nbs_project_id, nbs_component_id, matched_by, confidence, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(revit_type_id, nbs_project_id) DO UPDATE SET
               nbs_component_id=excluded.nbs_component_id,
               matched_by=excluded.matched_by,
               confidence=excluded.confidence,
               timestamp=excluded.timestamp`,
            [r.typeId, String(projectId), String(component.id), r.match.method, r.match.confidence, now]
          );
          dbRun(
            `INSERT INTO nbs_sync_log (operation, revit_type_id, nbs_component_id, source, dry_run, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ["sync_revit_types_to_nbs", r.typeId, String(component.id), "server", 0, now]
          );
        }

        let writeResult: unknown = null;
        if (writeRequests.length > 0) {
          writeResult = await withRevitConnection(async (revitClient) => {
            return revitClient.sendCommand("set_element_parameters", { requests: writeRequests });
          }, 60000);
        }

        return rawToolResponse("sync_revit_types_to_nbs", {
          ...summary,
          typesWritten: autoWritable.length,
          writeResult,
        });
      } catch (error) {
        return rawToolError("sync_revit_types_to_nbs", `Sync failed: ${errorMessage(error)}`);
      }
    }
  );
}
