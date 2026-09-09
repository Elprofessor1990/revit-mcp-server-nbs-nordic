import type { AuditEvent } from "../types.js";

export interface AuditSink {
  append(event: AuditEvent): Promise<void>;
  schemaVersion(): number;
  close(): void;
}
