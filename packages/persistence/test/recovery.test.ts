import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  DatabaseRecoveryError,
  ProjectRepository,
  RecoveryRepository,
  databaseCompatibilityStatus,
  openDatabase,
  runDatabaseIntegrityCheck,
} from "../src/index.js";

const temporaryDirectories: string[] = [];
afterEach(() => temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("Foundation 8A persistence recovery boundary", () => {
  it("bootstraps a missing database and exposes an explicit bounded quick_check", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-missing-database-")); temporaryDirectories.push(directory);
    const path = join(directory, "new.sqlite");
    const database = openDatabase(path);
    expect(databaseCompatibilityStatus(database)).toMatchObject({
      compatible: true,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      supportedSchemaVersion: CURRENT_SCHEMA_VERSION,
      integrityStatus: "not-run",
    });
    expect(runDatabaseIntegrityCheck(database)).toMatchObject({ ok: true, method: "quick_check", results: ["ok"] });
    database.close();
  });

  it("rejects corrupt and future databases without replacing their exact bytes", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-database-preflight-")); temporaryDirectories.push(directory);
    const corruptPath = join(directory, "corrupt.sqlite");
    writeFileSync(corruptPath, Buffer.from("not-a-sqlite-database\0preserve-me", "utf8"));
    const corruptBefore = digest(corruptPath);
    expect(() => openDatabase(corruptPath)).toThrow(DatabaseRecoveryError);
    try { openDatabase(corruptPath); } catch (error) {
      expect((error as DatabaseRecoveryError).diagnostic).toMatchObject({ code: "database_corrupt", sourcePreserved: true });
    }
    expect(digest(corruptPath)).toBe(corruptBefore);

    const incompatiblePath = join(directory, "incompatible.sqlite");
    const incompatible = new DatabaseSync(incompatiblePath);
    incompatible.exec("CREATE TABLE unrelated_application_data (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    incompatible.prepare("INSERT INTO unrelated_application_data VALUES (?, ?)").run("keep", "these exact bytes");
    incompatible.close();
    const incompatibleBefore = digest(incompatiblePath);
    try { openDatabase(incompatiblePath); } catch (error) {
      expect((error as DatabaseRecoveryError).diagnostic).toMatchObject({ code: "database_incompatible", sourcePreserved: true });
    }
    expect(() => openDatabase(incompatiblePath)).toThrow(DatabaseRecoveryError);
    expect(digest(incompatiblePath)).toBe(incompatibleBefore);

    const futurePath = join(directory, "future.sqlite");
    const future = new DatabaseSync(futurePath);
    future.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    future.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(CURRENT_SCHEMA_VERSION + 1, "2026-08-30T00:00:00.000Z");
    future.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION + 1}`);
    future.close();
    const futureBefore = digest(futurePath);
    expect(() => openDatabase(futurePath)).toThrow(DatabaseRecoveryError);
    try { openDatabase(futurePath); } catch (error) {
      expect((error as DatabaseRecoveryError).diagnostic).toMatchObject({ code: "unsupported_future_schema", sourcePreserved: true });
    }
    expect(digest(futurePath)).toBe(futureBefore);
  });

  it("stores only bounded immutable metadata and cascades it on deliberate project deletion", () => {
    const database = openDatabase();
    try {
      new ProjectRepository(database).create("Recovery", "recovery-project", "long-form");
      const recovery = new RecoveryRepository(database);
      const backup = recovery.insertVerifiedBackup({
        schemaId: "cyoa.project-backup-record", schemaVersion: 1,
        backupId: "11111111-1111-4111-8111-111111111111",
        projectId: "recovery-project", gameId: "recovery-project",
        portableSchemaId: "cyoa.portable-project", portableSchemaVersion: 1,
        portableProjectFingerprint: "a".repeat(32), portableArchiveSha256: "b".repeat(64), portableArchiveByteCount: 123,
        sourceSqliteSchemaVersion: CURRENT_SCHEMA_VERSION, applicationVersion: "0.1.0",
        createdAt: "2026-08-30T00:00:00.000Z", verificationStatus: "verified",
        verifiedAt: "2026-08-30T00:00:01.000Z", verificationMethod: "isolated-portable-restore", verificationMethodVersion: 1,
        restoredSemanticFingerprint: "a".repeat(32), verificationDiagnostics: [], sourceChangeFingerprint: "a".repeat(32),
      });
      recovery.insertRestore({
        schemaId: "cyoa.project-restore-record", schemaVersion: 1,
        restoreId: "22222222-2222-4222-8222-222222222222", projectId: "recovery-project", backupId: backup.backupId,
        sourceProjectId: "recovery-project", portableProjectFingerprint: "a".repeat(32), restoredSemanticFingerprint: "a".repeat(32),
        restoredAt: "2026-08-30T00:00:02.000Z", outcome: "restored", diagnostics: [],
      });
      recovery.setReminder("recovery-project", { dismissedForFingerprint: "a".repeat(32), snoozedUntil: null });
      expect(() => database.prepare("UPDATE project_backup_records SET application_version = 'changed'").run()).toThrow(/immutable/);
      expect(() => database.prepare("UPDATE project_restore_records SET outcome = 'restored'").run()).toThrow(/immutable/);
      expect(Object.keys(database.prepare("SELECT * FROM project_backup_records").get() as object)).not.toContain("archive_body");
      new ProjectRepository(database).remove("recovery-project");
      expect((database.prepare("SELECT COUNT(*) count FROM project_backup_records").get() as { count: number }).count).toBe(0);
      expect((database.prepare("SELECT COUNT(*) count FROM project_restore_records").get() as { count: number }).count).toBe(0);
      expect((database.prepare("SELECT COUNT(*) count FROM project_recovery_state").get() as { count: number }).count).toBe(0);
    } finally { database.close(); }
  });
});
