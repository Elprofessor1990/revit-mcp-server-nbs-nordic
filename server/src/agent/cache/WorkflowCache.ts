import type { WorkflowPlan } from "../types.js";

export interface WorkflowCache {
  lookup(signature: string, catalogFingerprint: string): Promise<WorkflowPlan[]>;
  recordSuccess(plan: WorkflowPlan, elapsedMs: number): Promise<void>;
  recordFailure(plan: WorkflowPlan, code: string): Promise<void>;
  prune(now?: number): Promise<void>;
  clear(): Promise<void>;
  schemaVersion(): number;
  close(): void;
}
