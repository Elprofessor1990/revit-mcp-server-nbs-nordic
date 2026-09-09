import { errorMessage } from "../utils/errorUtils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withRevitConnection } from "../utils/ConnectionManager.js";
import { rawToolResponse, rawToolError } from "../utils/compactTool.js";
import { listComponents } from "../integrations/nbs/components/ComponentService.js";
import { nbsClient } from "../integrations/nbs/NbsClient.js";
import { getModelContext, validateProjectId } from "../integrations/nbs/ProjectConnection.js";
import { buildSyncPlan, type SyncSnapshot } from "../integrations/nbs/matching/SyncPlanner.js";
import type { NbsProject } from "../integrations/nbs/NbsTypes.js";
import { dbRun } from "../database/db.js";

export function registerSyncRevitTypesToNbsTool(server: McpServer) {
  server.tool("sync_revit_types_to_nbs",
    "On-demand NBS-to-Revit parameter sync. Explicitly choose Type Only, Instance Only or Type and Instance. Type and instance links are independent; never overwrite an instance link from its type. Uses the NBS project saved in the active model. Writes existing NBS component IDs, full classification, name, date and published document links. NOT the official NBS addin's two-way Sync Now: does not upload models/quantities, create components, allocate .001-.050 numbers or change native addin settings. Defaults to preview; writes are model-guarded, verified and atomic.", {
      category: z.string().describe("Revit BuiltInCategory, e.g. OST_Walls or OST_Doors."),
      linkMode: z.enum(["typeOnly", "instanceOnly", "typeAndInstance"]).describe("Required sync target: Type Only, Instance Only, or Type and Instance. Independent of the official NBS addin's UI setting."),
      projectId: z.union([z.string(), z.number()]).optional().describe("Optional assertion: must match this model's NBS project."),
      maxTypes: z.number().int().min(1).max(2000).default(500),
      dryRun: z.boolean().default(true),
      explicitMapping: z.record(z.number().int().positive()).optional().describe("User-approved Revit type ID to NBS component ID mapping for otherwise ambiguous/unmatched types."),
      explicitInstanceMapping: z.record(z.number().int().positive()).optional().describe("User-approved Revit instance UniqueId to existing NBS component ID. Can link different instances of one type to different NBS components. Preview lists unresolved instance UniqueIds."),
      inheritTypeForUnlinkedInstances: z.boolean().default(false).describe("Only for Type and Instance: explicitly copy a reliable type link to completely unlinked instances. Existing instance IDs/codes are always preserved. Does not allocate unique numbers."),
    }, async args => {
      try {
        const context = await getModelContext();
        if (!context.projectId) throw new Error("Connect this model once with nbs_connect_project before synchronizing.");
        const projectId = validateProjectId(context.projectId);
        if (args.projectId !== undefined && validateProjectId(args.projectId) !== projectId)
          throw new Error("Requested NBS project does not match the model's persisted project. No parameters were changed.");
        if (context.missingParameters.length) throw new Error("NBS bindings are incomplete. Run nbs_connect_project for the same project to repair them.");

        const snapshot = await withRevitConnection(c => c.sendCommand("nbs_project", {
          operation: "snapshot", category: args.category, maxTypes: args.maxTypes,
        }), 35000) as SyncSnapshot;
        if (snapshot.modelKey !== context.modelKey || snapshot.projectId !== context.projectId)
          throw new Error("The active Revit model changed during the operation. Retry from the intended model.");
        const [components, project] = await Promise.all([
          listComponents(projectId), nbsClient.request<NbsProject>(`/projects/${projectId}`),
        ]);
        const plan = buildSyncPlan(snapshot, components, project, args.explicitMapping, {
          linkMode: args.linkMode, explicitInstanceMapping: args.explicitInstanceMapping,
          inheritTypeForUnlinkedInstances: args.inheritTypeForUnlinkedInstances,
        });
        const inScopeRows = plan.rows.filter(r => r.inScope);
        const summary = {
          projectId, modelKey: snapshot.modelKey, category: args.category,
          linkMode: plan.linkMode, direction: "nbsToRevit", nativeNbsSettingsChanged: false,
          instances: snapshot.instances.length, uniqueTypes: snapshot.types.length,
          alreadyLinked: inScopeRows.filter(r => r.match.method === "id").length,
          exactMatches: inScopeRows.filter(r => r.match.component && r.match.confidence >= 0.9 && !r.match.ambiguous).length,
          dryRun: args.dryRun, parametersToUpdate: plan.requests.length,
          typesToUpdate: plan.updatedTypes.length, instancesToUpdate: plan.updatedInstances.length,
          unresolvedTypes: inScopeRows.filter(r => r.match.method === "none" && !r.match.ambiguous),
          nameMatchProposals: inScopeRows.filter(r => r.match.confidence > 0 && r.match.confidence < 0.9 && !r.match.ambiguous),
          ambiguousMatches: inScopeRows.filter(r => r.match.ambiguous),
          instanceMatches: plan.instanceRows,
          readyToWrite: plan.requests.length > 0,
          note: plan.requests.length === 0 ? "No changes: either values are current or links are unresolved. Inspect unresolvedTypes and instanceMatches; connection alone does not choose a building component." : "Only listed, reliably linked elements will be updated; unresolved links remain unchanged.",
        };
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
