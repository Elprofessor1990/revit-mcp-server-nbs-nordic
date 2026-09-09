import type { WorkflowPlan } from "../types.js";
import type { WorkflowCache } from "./WorkflowCache.js";
import { SqliteFileStore, type SqliteMigration } from "../storage/SqliteFileStore.js";

const CACHE_SCHEMA_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

const CACHE_MIGRATIONS: readonly SqliteMigration[] = [{
  version: CACHE_SCHEMA_VERSION,
  statements: [
    `CREATE TABLE workflow_cache (
      id INTEGER PRIMARY KEY,
      intent_signature TEXT NOT NULL,
      intent_kind TEXT NOT NULL,
      catalog_fingerprint TEXT NOT NULL,
      workflow_schema_version INTEGER NOT NULL,
      plan_json TEXT NOT NULL,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      avg_execution_ms REAL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      UNIQUE(intent_signature, catalog_fingerprint, plan_json)
    )`,
    `CREATE INDEX idx_workflow_cache_lookup
      ON workflow_cache(intent_signature, catalog_fingerprint, expires_at)`,
    `CREATE INDEX idx_workflow_cache_prune
      ON workflow_cache(expires_at, last_used_at)`,
    `CREATE TABLE workflow_runs (
      run_id TEXT PRIMARY KEY,
      workflow_id INTEGER,
      intent_kind TEXT NOT NULL,
      cache_hit INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      error_code TEXT,
      FOREIGN KEY (workflow_id) REFERENCES workflow_cache(id) ON DELETE SET NULL
    )`,
  ],
}];

export interface SqliteWorkflowCacheOptions {
  filePath: string;
  maxEntries?: number;
  ttlDays?: number;
  minSuccessCountForReuse?: number;
  maxWorkflowSteps?: number;
  wasmPath?: string;
  now?: () => number;
}

export class SqliteWorkflowCache implements WorkflowCache {
  private readonly store: SqliteFileStore;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly minSuccessCountForReuse: number;
  private readonly maxWorkflowSteps: number;
  private readonly now: () => number;

  private constructor(options: SqliteWorkflowCacheOptions) {
    this.store = new SqliteFileStore({
      filePath: options.filePath,
      recoverCorrupt: true,
      wasmPath: options.wasmPath,
    });
    this.maxEntries = options.maxEntries ?? 500;
    this.ttlMs = (options.ttlDays ?? 30) * DAY_MS;
    this.minSuccessCountForReuse = options.minSuccessCountForReuse ?? 2;
    this.maxWorkflowSteps = options.maxWorkflowSteps ?? 20;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1)
      throw new Error("maxEntries must be a positive integer.");
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0)
      throw new Error("ttlDays must be positive.");
    if (!Number.isInteger(this.minSuccessCountForReuse) || this.minSuccessCountForReuse < 1)
      throw new Error("minSuccessCountForReuse must be a positive integer.");
    if (!Number.isInteger(this.maxWorkflowSteps) || this.maxWorkflowSteps < 1)
      throw new Error("maxWorkflowSteps must be a positive integer.");
  }

  static async open(options: SqliteWorkflowCacheOptions): Promise<SqliteWorkflowCache> {
    const cache = new SqliteWorkflowCache(options);
    await cache.store.open(CACHE_MIGRATIONS);
    await cache.prune();
    return cache;
  }

  async lookup(signature: string, catalogFingerprint: string): Promise<WorkflowPlan[]> {
    const now = this.now();
    const rows = this.store.all(
      `SELECT plan_json FROM workflow_cache
       WHERE intent_signature = ? AND catalog_fingerprint = ?
         AND expires_at > ? AND success_count >= ?
       ORDER BY (success_count * 1.0 / (success_count + failure_count)) DESC,
                last_used_at DESC`,
      [signature, catalogFingerprint, now, this.minSuccessCountForReuse]
    );
    return rows.map(row => JSON.parse(String(row.plan_json)) as WorkflowPlan);
  }

  async recordSuccess(plan: WorkflowPlan, elapsedMs: number): Promise<void> {
    this.validatePlan(plan);
    const now = this.now();
    const planJson = JSON.stringify(plan);
    this.store.run(
      `INSERT INTO workflow_cache (
        intent_signature, intent_kind, catalog_fingerprint, workflow_schema_version,
        plan_json, success_count, failure_count, avg_execution_ms,
        created_at, last_used_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)
      ON CONFLICT(intent_signature, catalog_fingerprint, plan_json) DO UPDATE SET
        success_count = success_count + 1,
        avg_execution_ms = ((COALESCE(avg_execution_ms, 0) * success_count) + excluded.avg_execution_ms)
          / (success_count + 1),
        last_used_at = excluded.last_used_at,
        expires_at = excluded.expires_at`,
      [
        plan.intentSignature, plan.intentKind, plan.catalogFingerprint, plan.schemaVersion,
        planJson, elapsedMs, now, now, now + this.ttlMs,
      ]
    );
    await this.prune(now);
  }

  async recordFailure(plan: WorkflowPlan, code: string): Promise<void> {
    this.validatePlan(plan);
    const now = this.now();
    const planJson = JSON.stringify(plan);
    this.store.run(
      `INSERT INTO workflow_cache (
        intent_signature, intent_kind, catalog_fingerprint, workflow_schema_version,
        plan_json, success_count, failure_count, last_error_code,
        created_at, last_used_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?)
      ON CONFLICT(intent_signature, catalog_fingerprint, plan_json) DO UPDATE SET
        failure_count = failure_count + 1,
        last_error_code = excluded.last_error_code,
        last_used_at = excluded.last_used_at,
        expires_at = excluded.expires_at`,
      [
        plan.intentSignature, plan.intentKind, plan.catalogFingerprint, plan.schemaVersion,
        planJson, code, now, now, now + this.ttlMs,
      ]
    );
    await this.prune(now);
  }

  async prune(now = this.now()): Promise<void> {
    this.store.transaction(database => {
      database.run("DELETE FROM workflow_cache WHERE expires_at <= ?", [now]);
      const countResult = database.exec("SELECT COUNT(*) AS count FROM workflow_cache");
      const count = Number(countResult[0]?.values[0]?.[0] ?? 0);
      const overflow = count - this.maxEntries;
      if (overflow > 0) {
        database.run(
          `DELETE FROM workflow_cache WHERE id IN (
            SELECT id FROM workflow_cache ORDER BY last_used_at ASC, id ASC LIMIT ?
          )`,
          [overflow]
        );
      }
    });
  }

  async clear(): Promise<void> {
    this.store.transaction(database => {
      database.run("DELETE FROM workflow_runs");
      database.run("DELETE FROM workflow_cache");
    });
  }

  schemaVersion(): number {
    return this.store.schemaVersion();
  }

  close(): void {
    this.store.close();
  }

  private validatePlan(plan: WorkflowPlan): void {
    if (plan.steps.length > this.maxWorkflowSteps)
      throw new Error(`Workflow exceeds the ${this.maxWorkflowSteps}-step cache limit.`);
  }
}
