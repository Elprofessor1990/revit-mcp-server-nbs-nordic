import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";

export interface SqliteMigration {
  version: number;
  statements: readonly string[];
}

export interface SqliteFileStoreOptions {
  filePath: string;
  recoverCorrupt?: boolean;
  wasmPath?: string;
}

export type SqliteParameter = string | number | Uint8Array | null;

const bundledDirectory = dirname(fileURLToPath(import.meta.url));

export class SqliteFileStore {
  private database: SqlJsDatabase | null = null;

  constructor(private readonly options: SqliteFileStoreOptions) {}

  async open(migrations: readonly SqliteMigration[]): Promise<void> {
    if (this.database) return;
    const SQL = await initSqlJs({
      locateFile: () => this.options.wasmPath ?? join(bundledDirectory, "sql-wasm.wasm"),
    });
    try {
      this.database = new SQL.Database(readFileSync(this.options.filePath));
    } catch (error) {
      if (!this.options.recoverCorrupt && this.fileExists()) throw error;
      this.database = new SQL.Database();
    }
    this.database.run("PRAGMA foreign_keys = ON");
    this.applyMigrations(migrations);
    this.flush();
  }

  run(sql: string, params?: SqliteParameter[]): void {
    this.getDatabase().run(sql, params);
    this.flush();
  }

  get(sql: string, params?: SqliteParameter[]): Record<string, unknown> | undefined {
    const statement = this.getDatabase().prepare(sql);
    try {
      if (params) statement.bind(params);
      return statement.step() ? statement.getAsObject() : undefined;
    } finally {
      statement.free();
    }
  }

  all(sql: string, params?: SqliteParameter[]): Record<string, unknown>[] {
    const statement = this.getDatabase().prepare(sql);
    const rows: Record<string, unknown>[] = [];
    try {
      if (params) statement.bind(params);
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }

  transaction(operation: (database: SqlJsDatabase) => void): void {
    const database = this.getDatabase();
    database.run("BEGIN IMMEDIATE");
    try {
      operation(database);
      database.run("COMMIT");
      this.flush();
    } catch (error) {
      database.run("ROLLBACK");
      throw error;
    }
  }

  schemaVersion(): number {
    const row = this.get("SELECT MAX(version) AS version FROM schema_migrations");
    return Number(row?.version ?? 0);
  }

  close(): void {
    if (!this.database) return;
    this.flush();
    this.database.close();
    this.database = null;
  }

  private applyMigrations(migrations: readonly SqliteMigration[]): void {
    const database = this.getDatabase();
    database.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`);
    const applied = new Set(
      this.all("SELECT version FROM schema_migrations").map(row => Number(row.version))
    );
    for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
      if (applied.has(migration.version)) continue;
      database.run("BEGIN IMMEDIATE");
      try {
        for (const statement of migration.statements) database.run(statement);
        database.run(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          [migration.version, Date.now()]
        );
        database.run("COMMIT");
      } catch (error) {
        database.run("ROLLBACK");
        throw error;
      }
    }
  }

  private flush(): void {
    if (!this.database) return;
    mkdirSync(dirname(this.options.filePath), { recursive: true });
    const temporaryPath = `${this.options.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, Buffer.from(this.database.export()));
    try {
      renameSync(temporaryPath, this.options.filePath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }

  private fileExists(): boolean {
    try {
      readFileSync(this.options.filePath);
      return true;
    } catch {
      return false;
    }
  }

  private getDatabase(): SqlJsDatabase {
    if (!this.database) throw new Error("SQLite store is not open.");
    return this.database;
  }
}
