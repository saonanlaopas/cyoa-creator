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

const backupRecord = (projectId: string, backupId: string, fingerprint = "a".repeat(32)) => ({
  schemaId: "cyoa.project-backup-record" as const, schemaVersion: 1 as const,
  backupId, projectId, gameId: projectId,
  portableSchemaId: "cyoa.portable-project" as const, portableSchemaVersion: 1 as const,
  portableProjectFingerprint: fingerprint, portableArchiveSha256: "b".repeat(64), portableArchiveByteCount: 123,
  sourceSqliteSchemaVersion: CURRENT_SCHEMA_VERSION, applicationVersion: "0.1.0",
  createdAt: "2026-08-30T00:00:00.000Z", verificationStatus: "verified" as const,
  verifiedAt: "2026-08-30T00:00:01.000Z", verificationMethod: "isolated-portable-restore" as const,
  verificationMethodVersion: 1 as const, restoredSemanticFingerprint: fingerprint,
  verificationDiagnostics: [], sourceChangeFingerprint: fingerprint,
});

const restoreRecord = (projectId: string, backupId: string, restoreId: string, fingerprint = "a".repeat(32)) => ({
  schemaId: "cyoa.project-restore-record" as const, schemaVersion: 1 as const,
  restoreId, projectId, backupId, sourceProjectId: projectId,
  portableProjectFingerprint: fingerprint, restoredSemanticFingerprint: fingerprint,
  restoredAt: "2026-08-30T00:00:02.000Z", outcome: "restored" as const, diagnostics: [],
});

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
      expect(() => database.prepare("DELETE FROM project_restore_records").run()).toThrow(/immutable/);
      expect(() => database.prepare("DELETE FROM project_backup_records").run()).toThrow(/immutable/);
      expect(Object.keys(database.prepare("SELECT * FROM project_backup_records").get() as object)).not.toContain("archive_body");
      new ProjectRepository(database).remove("recovery-project");
      expect((database.prepare("SELECT COUNT(*) count FROM project_backup_records").get() as { count: number }).count).toBe(0);
      expect((database.prepare("SELECT COUNT(*) count FROM project_restore_records").get() as { count: number }).count).toBe(0);
      expect((database.prepare("SELECT COUNT(*) count FROM project_recovery_state").get() as { count: number }).count).toBe(0);
    } finally { database.close(); }
  });

  it("enforces exact backup-to-restore lineage in both the repository and direct SQL", () => {
    const database = openDatabase();
    try {
      const projects = new ProjectRepository(database);
      projects.create("Project A", "project-a", "long-form");
      projects.create("Project B", "project-b", "long-form");
      const recovery = new RecoveryRepository(database);
      const backupA = recovery.insertVerifiedBackup(backupRecord("project-a", "11111111-1111-4111-8111-111111111111"));
      const backupB = recovery.insertVerifiedBackup(backupRecord("project-b", "22222222-2222-4222-8222-222222222222", "c".repeat(32)));

      expect(() => recovery.insertRestore(restoreRecord(
        "project-a", backupB.backupId, "33333333-3333-4333-8333-333333333333", "c".repeat(32),
      ))).toThrow(/exact verified backup/);
      expect(() => recovery.insertRestore(restoreRecord(
        "project-a", "44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555",
      ))).toThrow(/exact verified backup/);
      expect(() => recovery.insertRestore(restoreRecord(
        "project-a", backupA.backupId, "66666666-6666-4666-8666-666666666666", "d".repeat(32),
      ))).toThrow(/exact verified backup/);

      const insertSql = `INSERT INTO project_restore_records (
        id, project_id, backup_id, schema_id, schema_version, source_project_id,
        portable_project_fingerprint, restored_semantic_fingerprint, restored_at, outcome, diagnostics_json
      ) VALUES (?, ?, ?, 'cyoa.project-restore-record', 1, ?, ?, ?, ?, 'restored', '[]')`;
      expect(() => database.prepare(insertSql).run(
        "77777777-7777-4777-8777-777777777777", "project-a", backupB.backupId,
        "project-a", "c".repeat(32), "c".repeat(32), "2026-08-30T00:00:03.000Z",
      )).toThrow(/exact backup lineage/);
      expect(() => database.prepare(insertSql).run(
        "88888888-8888-4888-8888-888888888888", "project-a", backupA.backupId,
        "project-a", "d".repeat(32), "d".repeat(32), "2026-08-30T00:00:04.000Z",
      )).toThrow(/exact backup lineage/);

      expect(recovery.insertRestore(restoreRecord(
        "project-a", backupA.backupId, "99999999-9999-4999-8999-999999999999",
      )).backupId).toBe(backupA.backupId);
    } finally { database.close(); }
  });

  it("blocks opening corrupted existing recovery lineage without changing it", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-corrupt-recovery-lineage-")); temporaryDirectories.push(directory);
    const path = join(directory, "corrupt-lineage.sqlite");
    const database = openDatabase(path);
    const projects = new ProjectRepository(database);
    projects.create("Project A", "project-a", "long-form");
    projects.create("Project B", "project-b", "long-form");
    const recovery = new RecoveryRepository(database);
    const backupB = recovery.insertVerifiedBackup(backupRecord(
      "project-b", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "c".repeat(32),
    ));
    database.exec("DROP TRIGGER project_restore_records_exact_backup_insert");
    database.prepare(`INSERT INTO project_restore_records (
      id, project_id, backup_id, schema_id, schema_version, source_project_id,
      portable_project_fingerprint, restored_semantic_fingerprint, restored_at, outcome, diagnostics_json
    ) VALUES (?, ?, ?, 'cyoa.project-restore-record', 1, ?, ?, ?, ?, 'restored', '[]')`).run(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "project-a", backupB.backupId,
      "project-a", "c".repeat(32), "c".repeat(32), "2026-08-30T00:00:03.000Z",
    );
    const before = {
      version: (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      rows: database.prepare("SELECT * FROM project_restore_records").all(),
      triggers: database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all(),
    };
    database.close();

    expect(() => openDatabase(path)).toThrow(DatabaseRecoveryError);
    const rejected = new DatabaseSync(path);
    expect({
      version: (rejected.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      rows: rejected.prepare("SELECT * FROM project_restore_records").all(),
      triggers: rejected.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all(),
    }).toEqual(before);
    expect(rejected.prepare("SELECT name FROM sqlite_master WHERE name = 'project_restore_records_exact_backup_insert'").get()).toBeUndefined();
    rejected.close();
  });

  it.each([
    { phase: "mkdir", pathExists: false },
    { phase: "stat", pathExists: true },
    { phase: "open", pathExists: true },
  ])("normalizes $phase permission failures without replacing source bytes", ({ phase, pathExists }) => {
    const directory = mkdtempSync(join(tmpdir(), `cyoa-${phase}-permission-`)); temporaryDirectories.push(directory);
    const path = join(directory, "sentinel.sqlite");
    if (pathExists) writeFileSync(path, Buffer.from("preserve-these-source-bytes", "utf8"));
    const before = pathExists ? digest(path) : null;
    const denied = Object.assign(new Error("access denied by test boundary"), { code: "EACCES" });
    const invoke = () => openDatabase(path, {
      exists: () => pathExists,
      mkdir: phase === "mkdir" ? () => { throw denied; } : undefined,
      stat: phase === "stat" ? () => { throw denied; } : undefined,
      open: phase === "open" ? () => { throw denied; } : undefined,
    });
    expect(invoke).toThrow(DatabaseRecoveryError);
    try { invoke(); } catch (error) {
      expect((error as DatabaseRecoveryError).diagnostic).toMatchObject({
        code: "database_permission_denied", sourcePreserved: true,
      });
      expect((error as DatabaseRecoveryError).diagnostic.recommendation.length).toBeGreaterThan(20);
    }
    if (pathExists) expect(digest(path)).toBe(before);
  });
});
