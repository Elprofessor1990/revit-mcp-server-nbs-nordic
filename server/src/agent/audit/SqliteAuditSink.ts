import type { AuditEvent } from "../types.js";
import type { AuditSink } from "./AuditSink.js";
import { SqliteFileStore, type SqliteMigration } from "../storage/SqliteFileStore.js";

const AUDIT_SCHEMA_VERSION = 1;

const AUDIT_MIGRATIONS: readonly SqliteMigration[] = [{
  version: AUDIT_SCHEMA_VERSION,
  statements: [
    `CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      intent_kind TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      old_value_json TEXT NOT NULL,
      new_value_json TEXT NOT NULL,
      outcome TEXT NOT NULL,
      verified INTEGER NOT NULL,
      error_code TEXT,
      error_message TEXT
    )`,
    "CREATE INDEX idx_audit_events_run ON audit_events(run_id, timestamp)",
    "CREATE INDEX idx_audit_events_timestamp ON audit_events(timestamp)",
  ],
}];

export interface SqliteAuditSinkOptions {
  filePath: string;
  wasmPath?: string;
}

export class SqliteAuditSink implements AuditSink {
  private readonly store: SqliteFileStore;

  private constructor(options: SqliteAuditSinkOptions) {
    this.store = new SqliteFileStore({
      filePath: options.filePath,
      recoverCorrupt: false,
      wasmPath: options.wasmPath,
    });
  }

  static async open(options: SqliteAuditSinkOptions): Promise<SqliteAuditSink> {
    const sink = new SqliteAuditSink(options);
    await sink.store.open(AUDIT_MIGRATIONS);
    return sink;
  }

  async append(event: AuditEvent): Promise<void> {
    this.store.run(
      `INSERT INTO audit_events (
        run_id, timestamp, intent_kind, tool_id, target_kind, target_id,
        old_value_json, new_value_json, outcome, verified, error_code, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.runId,
        event.timestamp,
        event.intentKind,
        event.toolId,
        event.targetKind,
        event.targetId,
        JSON.stringify(event.oldValue ?? null),
        JSON.stringify(event.newValue ?? null),
        event.outcome,
        event.verified ? 1 : 0,
        event.errorCode ?? null,
        event.errorMessage ?? null,
      ]
    );
  }

  schemaVersion(): number {
    return this.store.schemaVersion();
  }

  close(): void {
    this.store.close();
  }
}
