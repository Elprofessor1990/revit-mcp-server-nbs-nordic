export type AccessMode = "READ" | "WRITE" | "MIXED";

export interface ToolDescriptor {
  toolId: string;
  purpose: string;
  access: AccessMode;
  categories: string[];
  inputSchemaFingerprint: string;
  sideEffects: string[];
  risk: "low" | "medium" | "high";
}

export interface WorkflowStep {
  toolId: string;
  argsTemplate: Record<string, unknown>;
  phase: "read" | "validate" | "write" | "verify";
}

export interface WorkflowPlan {
  schemaVersion: number;
  intentKind: string;
  intentSignature: string;
  catalogFingerprint: string;
  steps: WorkflowStep[];
  requiresConfirmation: boolean;
}

export interface RuleDecision {
  allowed: boolean;
  code: string;
  reasons: string[];
}

export interface AuditEvent {
  timestamp: number;
  runId: string;
  intentKind: string;
  toolId: string;
  targetKind: string;
  targetId: string;
  oldValue: unknown;
  newValue: unknown;
  outcome: "success" | "failure" | "rolled_back";
  verified: boolean;
  errorCode?: string;
  errorMessage?: string;
}
