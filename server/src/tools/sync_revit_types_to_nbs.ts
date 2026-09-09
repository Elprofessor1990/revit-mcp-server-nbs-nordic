import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withRevitConnection } from "../utils/ConnectionManager.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";
import { listComponents } from "../integrations/nbs/components/ComponentService.js";
import { nbsClient } from "../integrations/nbs/NbsClient.js";
import { getModelContext, validateProjectId } from "../integrations/nbs/ProjectConnection.js";
import { buildSyncPlan, type SyncSnapshot } from "../integrations/nbs/matching/SyncPlanner.js";
import { NBS_SYNC_FIELDS, readModelSettings, resolveLinkMode } from "../integrations/nbs/ModelSettings.js";
import type { NbsProject } from "../integrations/nbs/NbsTypes.js";
import { dbRun } from "../database/db.js";

/** Internal observation/guard only; never exposed in the MCP input schema. */
export interface SyncExecutionPlan {
  modelKey: string;
  projectId: string;
  category: string;
  dryRun: boolean;
  unresolved: boolean;
  requests: ReturnType<typeof buildSyncPlan>["requests"];
}

export interface SyncExecutionHooks {
  beforeWriteOrPreview(plan: SyncExecutionPlan): Promise<void>;
}

export function registerSyncRevitTypesToNbsTool(server: McpServer, hooks?: SyncExecutionHooks) {
  server.tool("sync_revit_types_to_nbs",
    "On-demand NBS-to-Revit parameter sync. Link mode (Type Only / Instance Only / Type and Instance) and the set of NBS fields to write default to what the user saved for this model in Revit Settings > NBS Nordic, falling back to the Link Type the official NBS addin stored in the model; pass them explicitly to override for one call. Type and instance links are independent; never overwrite an instance link from its type. Uses the NBS project saved in the active model. Can write NBS component IDs, full classification, name, date and published document links. NOT the official NBS addin's two-way Sync Now: does not upload models/quantities, create components or change native addin settings. NBS data model (verified 2026-09-09): a building component's serial (.001, .002 ...) identifies the component, not an element; NBS links components per Revit type (category) and its instances carry only quantities, so there is no per-element numbering to allocate. Defaults to preview; writes are model-guarded, verified and atomic.", {
      category: z.string().describe("Revit BuiltInCategory, e.g. OST_Walls or OST_Doors."),
      linkMode: z.enum(["typeOnly", "instanceOnly", "typeAndInstance"]).optional().describe("Sync target. Omit to use the link mode the user saved for this model in Revit Settings, else the Link Type set in the official NBS Nordic addin; if neither exists, the call fails and the user must choose."),
      fields: z.array(z.enum(NBS_SYNC_FIELDS)).min(1).optional().describe("NBS fields to write: id, classificationcode, name, date, docLink. Omit to use the user's saved selection for this model (default: all)."),
      projectId: z.union([z.string(), z.number()]).optional().describe("Optional assertion: must match this model's NBS project."),
      maxTypes: z.number().int().min(1).max(2000).default(500),
      dryRun: z.boolean().default(true),
      explicitMapping: z.record(z.number().int().positive()).optional().describe("User-approved Revit type ID to NBS component ID mapping for otherwise ambiguous/unmatched types."),
      explicitInstanceMapping: z.record(z.number().int().positive()).optional().describe("User-approved Revit instance UniqueId to existing NBS component ID. Can link different instances of one type to different NBS components. Preview lists unresolved instance UniqueIds."),
      inheritTypeForUnlinkedInstances: z.boolean().default(false).describe("Only for Type and Instance: explicitly copy a reliable type link to completely unlinked instances. Existing instance IDs/codes are always preserved. Instances get the type's component; NBS has no per-element numbering."),
    }, async args => {
      try {
        const context = await getModelContext();
        if (!context.projectId) throw new Error("Connect this model once with nbs_connect_project before synchronizing.");
        const projectId = validateProjectId(context.projectId);
        if (args.projectId !== undefined && validateProjectId(args.projectId) !== projectId)
          throw new Error("Requested NBS project does not match the model's persisted project. No parameters were changed.");
        if (context.missingParameters.length) throw new Error("NBS bindings are incomplete. Run nbs_connect_project for the same project to repair them.");

        const saved = readModelSettings(context.modelKey);
        const { linkMode, source: linkModeSource } = resolveLinkMode(args.linkMode, saved, context.nativeLinkType);
        const fields = args.fields ?? saved.fields ?? [...NBS_SYNC_FIELDS];
        const fieldsSource = args.fields ? "call" : saved.fields ? "modelSettings" : "default";

        const snapshot = await withRevitConnection(c => c.sendCommand("nbs_project", {
          operation: "snapshot", category: args.category, maxTypes: args.maxTypes,
        }), 35000) as SyncSnapshot;
        if (snapshot.modelKey !== context.modelKey || snapshot.projectId !== context.projectId)
          throw new Error("The active Revit model changed during the operation. Retry from the intended model.");
        const [components, project] = await Promise.all([
          listComponents(projectId), nbsClient.request<NbsProject>(`/projects/${projectId}`),
        ]);
        const plan = buildSyncPlan(snapshot, components, project, args.explicitMapping, {
          linkMode, fields, explicitInstanceMapping: args.explicitInstanceMapping,
          inheritTypeForUnlinkedInstances: args.inheritTypeForUnlinkedInstances,
        });
        const inScopeRows = plan.rows.filter(r => r.inScope);
        // Instances that simply carry their existing component id are the common case
        // (96 identical rows = 75 kB live); report them as a count and list only the rest.
        const routineInstance = (r: (typeof plan.instanceRows)[number]) => r.match.method === "id" && !r.inheritedFromType && !r.match.ambiguous;
        const instanceSummary = {
          total: plan.instanceRows.length,
          linkedById: plan.instanceRows.filter(routineInstance).length,
          inheritedFromType: plan.instanceRows.filter(r => r.inheritedFromType).length,
          explicit: plan.instanceRows.filter(r => r.match.method === "explicit").length,
          ambiguous: plan.instanceRows.filter(r => r.match.ambiguous).length,
          unresolved: plan.instanceRows.filter(r => r.match.method === "none" && !r.match.ambiguous).length,
        };
        const summary = {
          projectId, modelKey: snapshot.modelKey, category: args.category,
          linkMode: plan.linkMode, linkModeSource, fields: plan.fields, fieldsSource,
          direction: "nbsToRevit", nativeNbsSettingsChanged: false,
          instances: snapshot.instances.length, uniqueTypes: snapshot.types.length,
          alreadyLinked: inScopeRows.filter(r => r.match.method === "id").length,
          exactMatches: inScopeRows.filter(r => r.match.component && r.match.confidence >= 0.9 && !r.match.ambiguous).length,
          dryRun: args.dryRun, parametersToUpdate: plan.requests.length,
          typesToUpdate: plan.updatedTypes.length, instancesToUpdate: plan.updatedInstances.length,
          unresolvedTypes: inScopeRows.filter(r => r.match.method === "none" && !r.match.ambiguous),
          nameMatchProposals: inScopeRows.filter(r => r.match.confidence > 0 && r.match.confidence < 0.9 && !r.match.ambiguous),
          ambiguousMatches: inScopeRows.filter(r => r.match.ambiguous),
          instanceSummary,
          instanceMatches: plan.instanceRows.filter(r => !routineInstance(r)),
          readyToWrite: plan.requests.length > 0,
          note: plan.requests.length === 0 ? "No changes: either values are current or links are unresolved. Inspect unresolvedTypes and instanceMatches; connection alone does not choose a building component." : "Only listed, reliably linked elements will be updated; unresolved links remain unchanged.",
        };
        // A private orchestrator can inspect/audit the exact existing requests and
        // reject a changed preview before any write. Ordinary MCP calls are unchanged.
        await hooks?.beforeWriteOrPreview({ modelKey: snapshot.modelKey, projectId,
          category: args.category, dryRun: args.dryRun,
          unresolved: summary.unresolvedTypes.length > 0 || summary.nameMatchProposals.length > 0 ||
            summary.ambiguousMatches.length > 0 || instanceSummary.unresolved > 0 || instanceSummary.ambiguous > 0,
          requests: structuredClone(plan.requests) });
        if (args.dryRun) return rawToolResponse("sync_revit_types_to_nbs", summary);
        if (!plan.requests.length) return rawToolResponse("sync_revit_types_to_nbs", {
          ...summary, typesWritten: 0, instancesWritten: 0, writtenParameters: 0, verified: true,
        });
        const result = await withRevitConnection(c => c.sendCommand("nbs_project", {
          operation: "write_parameters", expectedModelKey: snapshot.modelKey,
          projectId, requests: plan.requests,
        }), 35000) as { verified: boolean; writtenParameters: number };
        if (!result.verified || result.writtenParameters !== plan.requests.length)
          throw new Error("Revit did not verify every requested parameter. Re-read the model before retrying.");

        // Only persist verified mappings, scoped to the model as well as the NBS project.
        for (const row of inScopeRows.filter(r => r.match.component && r.match.confidence >= 0.9 && !r.match.ambiguous)) {
          dbRun(`INSERT INTO nbs_model_type_mappings (model_key, revit_type_id, nbs_project_id, nbs_component_id, matched_by, confidence, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(model_key, revit_type_id, nbs_project_id) DO UPDATE SET
            nbs_component_id=excluded.nbs_component_id, matched_by=excluded.matched_by, confidence=excluded.confidence, timestamp=excluded.timestamp`,
            [snapshot.modelKey, row.typeId, projectId, String(row.match.component!.id), row.match.method, row.match.confidence, Date.now()]);
        }
        return rawToolResponse("sync_revit_types_to_nbs", {
          ...summary, typesWritten: plan.updatedTypes.length, instancesWritten: plan.updatedInstances.length,
          writtenParameters: result.writtenParameters, verified: true,
        });
      } catch (error) { return rawToolError("sync_revit_types_to_nbs", `Sync failed: ${errorMessage(error)}`); }
    }
  );
}
