import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  ArtifactRepository,
  PortableProjectRepository,
  ProjectRepository,
  RecoveryRepository,
  openDatabase,
  type StoryDatabase,
} from "@story-to-cyoa/persistence";
import { defaultProjectBrief } from "@story-to-cyoa/pipeline";
import { stableFingerprint } from "@story-to-cyoa/runtime";
import { PublicationExportService } from "../src/services/publication-export-service.js";
import { RecoveryOperationError, RecoveryService, parseBackup } from "../src/services/recovery-service.js";

function context(database: StoryDatabase = openDatabase(), options: ConstructorParameters<typeof RecoveryService>[3] = {}) {
  const portable = new PortableProjectRepository(database);
  const publication = new PublicationExportService(portable, undefined);
  return { database, projects: new ProjectRepository(database), portable, publication,
    recovery: new RecoveryService(database, portable, publication, { applicationVersion: "8A-test", ...options }) };
}

describe("Foundation 8A verified project recovery", () => {
  it("normalizes a failed canonical export before any verification metadata exists", async () => {
    const source = context();
    try {
      await expect(source.recovery.createVerifiedBackup("missing-project"))
        .rejects.toMatchObject({ code: "backup_export_failed" });
      expect(source.projects.list({ includeArchived: true })).toEqual([]);
      expect((source.database.prepare("SELECT COUNT(*) AS count FROM project_backup_records").get() as { count: number }).count)
        .toBe(0);
    } finally { source.database.close(); }
  });

  it("creates a strict backup around unchanged portable-v1 bytes, previews without writes, and restores exact stable identity", async () => {
    const source = context();
    try {
      source.projects.create("Ångström 物語 — exact", "exact-project", "long-form");
      const portableBefore = source.publication.exportPortable("exact-project");
      const created = await source.recovery.createVerifiedBackup("exact-project");
      const outer = unzipSync(created.bytes);
      expect(Object.keys(outer).sort()).toEqual(["backup-record.json", "portable-project.cyoa.zip"]);
      expect(Buffer.from(outer["portable-project.cyoa.zip"]!).equals(Buffer.from(portableBefore.bytes))).toBe(true);
      expect(parseBackup(created.bytes).record).toEqual(created.record);
      expect(created.record).toMatchObject({
        projectId: "exact-project", gameId: "exact-project", verificationStatus: "verified",
        verificationMethod: "isolated-portable-restore", portableProjectFingerprint: portableBefore.manifest.projectFingerprint,
      });
      expect(created.record.portableArchiveSha256).toBe(createHash("sha256").update(portableBefore.bytes).digest("hex"));
      expect(new RecoveryRepository(source.database).listBackups("exact-project")).toHaveLength(1);

      const preview = await source.recovery.previewBackup(created.bytes);
      expect(preview).toMatchObject({ projectName: "Ångström 物語 — exact", conflict: true, verification: { verified: true } });
      expect(new RecoveryRepository(source.database).listRestores("exact-project")).toHaveLength(0);

      const status = source.recovery.status("exact-project");
      source.recovery.deleteProject("exact-project", { projectId: "exact-project", projectFingerprint: status.currentProjectFingerprint });
      expect(source.projects.get("exact-project")).toBeUndefined();
      const restored = await source.recovery.restoreBackup(created.bytes);
      expect(restored.projectId).toBe("exact-project");
      expect(source.projects.get("exact-project")?.name).toBe("Ångström 物語 — exact");
      expect(source.publication.exportPortable("exact-project").manifest.projectFingerprint).toBe(portableBefore.manifest.projectFingerprint);
      expect(new RecoveryRepository(source.database).listBackups("exact-project")).toHaveLength(1);
      expect(new RecoveryRepository(source.database).listRestores("exact-project")).toHaveLength(1);
    } finally { source.database.close(); }
  });

  it("rejects tampering and collisions without partial project, restore, or verified-backup rows", async () => {
    const source = context(); const target = context();
    try {
      source.projects.create("Source", "stable-id", "long-form");
      const backup = await source.recovery.createVerifiedBackup("stable-id");
      target.projects.create("Existing", "stable-id", "long-form");
      const targetFingerprint = target.publication.exportPortable("stable-id").manifest.projectFingerprint;
      await expect(target.recovery.restoreBackup(backup.bytes)).rejects.toMatchObject({ code: "portable_project_conflict" });
      expect(target.projects.get("stable-id")?.name).toBe("Existing");
      expect(target.publication.exportPortable("stable-id").manifest.projectFingerprint).toBe(targetFingerprint);
      expect(new RecoveryRepository(target.database).listBackups("stable-id")).toHaveLength(0);
      expect(new RecoveryRepository(target.database).listRestores("stable-id")).toHaveLength(0);

      const files = unzipSync(backup.bytes);
      files["portable-project.cyoa.zip"]![10] ^= 1;
      const tampered = zipSync(files);
      const empty = context();
      try {
        await expect(empty.recovery.previewBackup(tampered)).rejects.toBeInstanceOf(RecoveryOperationError);
        await expect(empty.recovery.restoreBackup(tampered)).rejects.toBeInstanceOf(RecoveryOperationError);
        expect(empty.projects.list({ includeArchived: true })).toEqual([]);
      } finally { empty.database.close(); }

      const hostile = zipSync({ "../escape": strToU8("x"), "portable-project.cyoa.zip": strToU8("x") });
      await expect(source.recovery.previewBackup(hostile)).rejects.toMatchObject({ code: "backup_archive_hostile" });

      const futureFiles = unzipSync(backup.bytes);
      const futureRecord = JSON.parse(new TextDecoder().decode(futureFiles["backup-record.json"]!));
      futureRecord.schemaVersion = 2;
      futureFiles["backup-record.json"] = strToU8(JSON.stringify(futureRecord));
      await expect(source.recovery.previewBackup(zipSync(futureFiles))).rejects.toMatchObject({ code: "backup_record_invalid" });
    } finally { source.database.close(); target.database.close(); }
  });

  it("refuses false verification when a self-consistent archive reconstructs to different canonical meaning", async () => {
    const source = context();
    try {
      source.projects.create("Canonical order", "canonical-order", "long-form");
      const artifacts = new ArtifactRepository(source.database);
      artifacts.saveArtifact({ projectId: "canonical-order", artifactId: "brief", artifactType: "brief", content: defaultProjectBrief("First") });
      artifacts.saveArtifact({ projectId: "canonical-order", artifactId: "brief", artifactType: "brief", content: defaultProjectBrief("Second") });
      const portable = source.publication.exportPortable("canonical-order");
      const files = unzipSync(portable.bytes);
      const payload = JSON.parse(new TextDecoder().decode(files["project.json"]!));
      payload.tables.artifact_versions.reverse();
      const rows = { projectId: payload.projectId, tables: payload.tables };
      const forgedFingerprint = stableFingerprint({
        schemaId: "cyoa.portable-project", schemaVersion: 1,
        historyMode: "immutable-authoring-history-v1", rows,
      });
      payload.projectFingerprint = forgedFingerprint;
      const payloadBytes = strToU8(JSON.stringify(payload));
      const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]!));
      manifest.projectFingerprint = forgedFingerprint;
      manifest.files[0].bytes = payloadBytes.byteLength;
      manifest.files[0].sha256 = createHash("sha256").update(payloadBytes).digest("hex");
      const forgedPortable = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), "project.json": payloadBytes });
      const backupRecord = {
        schemaId: "cyoa.project-backup-record", schemaVersion: 1,
        backupId: "33333333-3333-4333-8333-333333333333", projectId: "canonical-order", gameId: "canonical-order",
        portableSchemaId: "cyoa.portable-project", portableSchemaVersion: 1,
        portableProjectFingerprint: forgedFingerprint,
        portableArchiveSha256: createHash("sha256").update(forgedPortable).digest("hex"), portableArchiveByteCount: forgedPortable.byteLength,
        sourceSqliteSchemaVersion: 16, applicationVersion: "8A-test", createdAt: "2026-08-30T00:00:00.000Z",
        verificationStatus: "verified", verifiedAt: "2026-08-30T00:00:01.000Z",
        verificationMethod: "isolated-portable-restore", verificationMethodVersion: 1,
        restoredSemanticFingerprint: forgedFingerprint, verificationDiagnostics: [], sourceChangeFingerprint: forgedFingerprint,
      };
      const forgedBackup = zipSync({
        "backup-record.json": strToU8(JSON.stringify(backupRecord)),
        "portable-project.cyoa.zip": [forgedPortable, { level: 0 }],
      });
      await expect(source.recovery.previewBackup(forgedBackup)).rejects.toMatchObject({ code: "backup_semantic_mismatch" });
      expect(new RecoveryRepository(source.database).listBackups("canonical-order")).toEqual([]);
    } finally { source.database.close(); }
  });

  it("captures version A under a concurrent edit, verifies A, and reports current version B as changed", async () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    projects.create("Version A", "concurrent-project", "long-form");
    const recoveryContext = context(database, {
      afterBackupCapture: () => { projects.rename("concurrent-project", "Version B"); },
    });
    try {
      const capturedA = recoveryContext.publication.exportPortable("concurrent-project").manifest.projectFingerprint;
      const backup = await recoveryContext.recovery.createVerifiedBackup("concurrent-project");
      expect(backup.record.portableProjectFingerprint).toBe(capturedA);
      expect((await recoveryContext.recovery.previewBackup(backup.bytes)).projectName).toBe("Version A");
      expect(projects.get("concurrent-project")?.name).toBe("Version B");
      expect(recoveryContext.recovery.status("concurrent-project")).toMatchObject({
        freshness: "changes-since-backup", reminder: { visible: true },
      });
    } finally { database.close(); }
  });

  it("keeps an unchanged verified backup current across database and service restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cyoa-recovery-restart-"));
    const databasePath = join(directory, "story.sqlite");
    try {
      const first = context(openDatabase(databasePath));
      first.projects.create("Restart persistence", "restart-project", "long-form");
      const before = first.publication.exportPortable("restart-project");
      const backup = await first.recovery.createVerifiedBackup("restart-project");
      expect(first.recovery.status("restart-project")).toMatchObject({
        freshness: "current", latestVerifiedBackup: { backupId: backup.record.backupId }, reminder: { visible: false },
      });
      expect(first.publication.exportPortable("restart-project").bytes).toEqual(before.bytes);
      first.database.close();

      const reopened = context(openDatabase(databasePath));
      try {
        expect(reopened.recovery.status("restart-project")).toMatchObject({
          freshness: "current", latestVerifiedBackup: { backupId: backup.record.backupId }, reminder: { visible: false },
        });
        expect(reopened.publication.exportPortable("restart-project").bytes).toEqual(before.bytes);
      } finally { reopened.database.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("uses distinct temporary workspaces for overlapping verification and cleans them", async () => {
    const root = await mkdtemp(join(tmpdir(), "cyoa-recovery-concurrency-"));
    const source = context(openDatabase(), { temporaryDirectoryRoot: root });
    try {
      source.projects.create("Parallel", "parallel-project", "long-form");
      const [first, second] = await Promise.all([
        source.recovery.createVerifiedBackup("parallel-project"),
        source.recovery.createVerifiedBackup("parallel-project"),
      ]);
      expect(first.record.backupId).not.toBe(second.record.backupId);
      expect(first.record.portableProjectFingerprint).toBe(second.record.portableProjectFingerprint);
      expect(await readdir(root)).toEqual([]);
    } finally { source.database.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("serializes simultaneous restores of one stable identity so exactly one commits", async () => {
    const source = context();
    try {
      source.projects.create("Restore race", "restore-race", "long-form");
      const backup = await source.recovery.createVerifiedBackup("restore-race");
      const state = source.recovery.status("restore-race");
      source.recovery.deleteProject("restore-race", { projectId: "restore-race", projectFingerprint: state.currentProjectFingerprint });
      const results = await Promise.allSettled([
        source.recovery.restoreBackup(backup.bytes),
        source.recovery.restoreBackup(backup.bytes),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(source.projects.get("restore-race")?.name).toBe("Restore race");
      expect(new RecoveryRepository(source.database).listBackups("restore-race")).toHaveLength(1);
      expect(new RecoveryRepository(source.database).listRestores("restore-race")).toHaveLength(1);
    } finally { source.database.close(); }
  });

  it("keeps reminder dismissal version-scoped and requires an exact fresh deletion confirmation", async () => {
    const source = context();
    try {
      source.projects.create("Reminder", "reminder-project", "long-form");
      expect(source.recovery.status("reminder-project")).toMatchObject({ freshness: "never-backed-up", reminder: { visible: true } });
      const dismissed = source.recovery.updateReminder("reminder-project", { action: "dismiss-current" });
      expect(dismissed.reminder).toMatchObject({ visible: false, dismissedForCurrentVersion: true });
      source.projects.rename("reminder-project", "Reminder changed");
      const changed = source.recovery.status("reminder-project");
      expect(changed.reminder).toMatchObject({ visible: true, dismissedForCurrentVersion: false });
      expect(() => source.recovery.deleteProject("reminder-project", {
        projectId: "reminder-project", projectFingerprint: dismissed.currentProjectFingerprint,
      })).toThrow(/delete_confirmation_stale/);
      expect(source.projects.get("reminder-project")).toBeDefined();
      source.recovery.deleteProject("reminder-project", {
        projectId: "reminder-project", projectFingerprint: changed.currentProjectFingerprint,
      });
      expect(source.projects.get("reminder-project")).toBeUndefined();
    } finally { source.database.close(); }
  });

  it("normalizes temp, isolated-open, archive, and metadata-write failures without a verified record or canonical mutation", async () => {
    const cases: Array<{
      label: string;
      options?: ConstructorParameters<typeof RecoveryService>[3];
      prepare?: (database: StoryDatabase) => void;
      cleanup?: () => Promise<void>;
      assert?: () => void;
    }> = [];
    cases.push({ label: "temp creation", options: { createTemporaryDirectory: async () => { throw new Error("temp unavailable"); } } });
    const root = await mkdtemp(join(tmpdir(), "cyoa-recovery-open-failure-"));
    const removed = vi.fn();
    cases.push({
      label: "isolated open",
      options: {
        temporaryDirectoryRoot: root,
        openIsolatedDatabase: () => { throw new Error("isolated disk read-only"); },
        removeTemporaryDirectory: async (path) => { removed(path); await rm(path, { recursive: true, force: true }); },
      },
      cleanup: async () => rm(root, { recursive: true, force: true }),
      assert: () => expect(removed).toHaveBeenCalledOnce(),
    });
    cases.push({ label: "archive creation", options: { encodeBackupArchive: () => { throw new Error("archive write failed"); } } });
    cases.push({
      label: "metadata write",
      prepare: (database) => database.exec(`CREATE TRIGGER reject_backup_write BEFORE INSERT ON project_backup_records
        BEGIN SELECT RAISE(ABORT, 'disk write failed'); END`),
    });
    for (const item of cases) {
      const current = context(openDatabase(), item.options);
      try {
        current.projects.create(`Failure ${item.label}`, "failure-project", "long-form");
        item.prepare?.(current.database);
        const before = current.publication.exportPortable("failure-project").manifest.projectFingerprint;
        await expect(current.recovery.createVerifiedBackup("failure-project")).rejects.toBeInstanceOf(RecoveryOperationError);
        expect(current.projects.get("failure-project")?.name).toBe(`Failure ${item.label}`);
        expect(current.publication.exportPortable("failure-project").manifest.projectFingerprint).toBe(before);
        expect(new RecoveryRepository(current.database).listBackups("failure-project")).toEqual([]);
        item.assert?.();
      } finally { current.database.close(); await item.cleanup?.(); }
    }
  });
});
