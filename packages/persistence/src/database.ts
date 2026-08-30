import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CURRENT_SCHEMA_VERSION, databaseSchemaVersion, migrate } from "./migrate.js";

export type StoryDatabase = DatabaseSync;

export interface DatabaseOpenOperations {
  exists(path: string): boolean;
  stat(path: string): { size: number };
  mkdir(path: string): void;
  open(path: string): StoryDatabase;
}

export type DatabaseRecoveryErrorCode =
  | "database_corrupt"
  | "database_incompatible"
  | "database_integrity_failed"
  | "database_permission_denied"
  | "database_read_only"
  | "database_unavailable"
  | "database_write_failed"
  | "migration_failed"
  | "unsupported_future_schema";

export interface DatabaseRecoveryDiagnostic {
  code: DatabaseRecoveryErrorCode;
  message: string;
  startingSchemaVersion: number | null;
  targetSchemaVersion: number;
  sourcePreserved: true;
  recommendation: string;
}

export class DatabaseRecoveryError extends Error {
  public constructor(public readonly diagnostic: DatabaseRecoveryDiagnostic, options?: ErrorOptions) {
    super(`${diagnostic.code}: ${diagnostic.message}`, options);
    this.name = "DatabaseRecoveryError";
  }
}

export function openDatabase(path = ":memory:", operations: Partial<DatabaseOpenOperations> = {}): StoryDatabase {
  const filesystem: DatabaseOpenOperations = {
    exists: operations.exists ?? existsSync,
    stat: operations.stat ?? statSync,
    mkdir: operations.mkdir ?? ((directory) => { mkdirSync(directory, { recursive: true }); }),
    open: operations.open ?? ((databasePath) => new DatabaseSync(databasePath)),
  };
  let existing = false;
  let existingBytes = 0;
  let database: StoryDatabase | undefined;
  let startingSchemaVersion: number | null = null;
  try {
    existing = path !== ":memory:" && filesystem.exists(path);
    existingBytes = existing ? filesystem.stat(path).size : 0;
    if (path !== ":memory:" && !existing) filesystem.mkdir(dirname(path));
    database = filesystem.open(path);
    // A lightweight schema read detects malformed/non-SQLite input before migration writes.
    database.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
    startingSchemaVersion = databaseSchemaVersion(database);
    migrate(database);
    return database;
  } catch (error) {
    try { database?.close(); } catch { /* Preserve the primary recovery error. */ }
    if (error instanceof DatabaseRecoveryError) throw error;
    throw normalizeDatabaseError(error, {
      existingNonEmpty: existing && existingBytes > 0,
      startingSchemaVersion,
    });
  }
}

export function databaseCompatibilityStatus(database: StoryDatabase): {
  compatible: true;
  schemaVersion: number;
  supportedSchemaVersion: number;
  userVersion: number;
  foreignKeys: boolean;
  journalMode: string;
  integrityStatus: "not-run";
} {
  const userVersion = (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  const foreignKeys = (database.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys;
  const journal = database.prepare("PRAGMA journal_mode").get() as Record<string, string>;
  return {
    compatible: true,
    schemaVersion: databaseSchemaVersion(database),
    supportedSchemaVersion: CURRENT_SCHEMA_VERSION,
    userVersion,
    foreignKeys: Boolean(foreignKeys),
    journalMode: String(Object.values(journal)[0] ?? "unknown"),
    integrityStatus: "not-run",
  };
}

export function runDatabaseIntegrityCheck(database: StoryDatabase): {
  ok: boolean;
  method: "quick_check";
  checkedAt: string;
  results: string[];
} {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = database.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
  } catch (error) {
    throw new DatabaseRecoveryError({
      code: "database_integrity_failed",
      message: "SQLite could not complete the bounded integrity check.",
      startingSchemaVersion: safeSchemaVersion(database),
      targetSchemaVersion: CURRENT_SCHEMA_VERSION,
      sourcePreserved: true,
      recommendation: "Stop editing this database and restore a verified project backup into a separate database.",
    }, { cause: error });
  }
  const results = rows.slice(0, 20).map((row) => String(Object.values(row)[0] ?? "unknown"));
  return { ok: results.length === 1 && results[0] === "ok", method: "quick_check", checkedAt: new Date().toISOString(), results };
}

export function transaction<T>(database: StoryDatabase, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function normalizeDatabaseError(error: unknown, context: {
  existingNonEmpty: boolean;
  startingSchemaVersion: number | null;
}): DatabaseRecoveryError {
  const value = error as { code?: string; message?: string };
  const message = String(value?.message ?? error ?? "Unknown database failure");
  const codeText = `${value?.code ?? ""} ${message}`.toLowerCase();
  let code: DatabaseRecoveryErrorCode;
  let recommendation: string;
  if (codeText.includes("unsupported_future_schema")) {
    code = "unsupported_future_schema";
    recommendation = "Open this database with the newer application version that created it, or restore a compatible verified backup as a new project.";
  } else if (codeText.includes("unsupported_historical_schema") || codeText.includes("database_incompatible")) {
    code = "database_incompatible";
    recommendation = "Keep the source file unchanged and use a supported historical application or a compatible portable project archive.";
  } else if (codeText.includes("not a database") || codeText.includes("malformed") || codeText.includes("corrupt")) {
    code = "database_corrupt";
    recommendation = "Keep the unreadable file unchanged and restore a verified project backup into a separate database.";
  } else if (codeText.includes("erofs") || codeText.includes("readonly") || codeText.includes("read-only")) {
    code = "database_read_only";
    recommendation = "Restore write access or copy the database using a consistency-safe SQLite tool before retrying.";
  } else if (codeText.includes("enospc") || codeText.includes("edquot")
    || codeText.includes("full") || codeText.includes("disk") && codeText.includes("write")) {
    code = "database_write_failed";
    recommendation = "Free storage or choose writable storage, then retry without deleting the source database.";
  } else if (codeText.includes("eacces") || codeText.includes("eperm")
    || codeText.includes("permission") || codeText.includes("access") && codeText.includes("denied")) {
    code = "database_permission_denied";
    recommendation = "Restore filesystem permission or choose an accessible database location; the source file was not replaced.";
  } else if (codeText.includes("enoent") || codeText.includes("enotdir") || codeText.includes("cantopen")
    || codeText.includes("cannot open") || codeText.includes("unable to open")) {
    code = "database_unavailable";
    recommendation = "Check that the configured storage location exists and is accessible, then retry.";
  } else {
    code = context.existingNonEmpty ? "migration_failed" : "database_unavailable";
    recommendation = context.existingNonEmpty
      ? "Keep the original database, correct the reported migration problem, or restore a verified backup into a separate database."
      : "Check the configured storage location and retry initialization.";
  }
  return new DatabaseRecoveryError({
    code,
    message: safeDatabaseMessage(code, context.startingSchemaVersion),
    startingSchemaVersion: context.startingSchemaVersion,
    targetSchemaVersion: CURRENT_SCHEMA_VERSION,
    sourcePreserved: true,
    recommendation,
  }, { cause: error });
}

function safeDatabaseMessage(code: DatabaseRecoveryErrorCode, startingSchemaVersion: number | null): string {
  switch (code) {
    case "unsupported_future_schema": return "The existing database was created by a newer unsupported schema and was not opened or changed.";
    case "database_corrupt": return "The existing database is unreadable or corrupt and was not replaced.";
    case "database_incompatible": return "The existing SQLite file is not a supported CYOA Creator database and was not changed.";
    case "database_read_only": return "The configured database cannot be written and was not changed.";
    case "database_write_failed": return "SQLite could not write required data; the source database was not replaced.";
    case "database_permission_denied": return "The configured database location is not permitted and was not changed.";
    case "migration_failed": return `Migration from schema ${startingSchemaVersion ?? "unknown"} to ${CURRENT_SCHEMA_VERSION} failed; the source database was preserved.`;
    case "database_integrity_failed": return "SQLite integrity checking failed.";
    default: return "The configured database could not be opened safely.";
  }
}

function safeSchemaVersion(database: StoryDatabase): number | null {
  try { return databaseSchemaVersion(database); } catch { return null; }
}
