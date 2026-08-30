import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  PROJECT_BACKUP_RECORD_SCHEMA_ID,
  PROJECT_BACKUP_RECORD_SCHEMA_VERSION,
  PROJECT_RESTORE_RECORD_SCHEMA_ID,
  PROJECT_RESTORE_RECORD_SCHEMA_VERSION,
  ProjectBackupRecordSchema,
  ProjectRestoreRecordSchema,
  type BackupFreshnessStatus,
  type ProjectBackupRecord,
  type ProjectRestoreRecord,
} from "@story-to-cyoa/domain";
import {
  CURRENT_SCHEMA_VERSION,
  PortableProjectRepository,
  ProjectRepository,
  RecoveryRepository,
  databaseCompatibilityStatus,
  databaseSchemaVersion,
  openDatabase,
  runDatabaseIntegrityCheck,
  transaction,
  type StoryDatabase,
} from "@story-to-cyoa/persistence";
import { PublicationExportService, PORTABLE_PROJECT_LIMITS, type PortableManifest } from "./publication-export-service.js";
import { validatePortableAuthoringProject } from "./portable-project-validator.js";

export const PROJECT_BACKUP_LIMITS = Object.freeze({
  archiveBytes: PORTABLE_PROJECT_LIMITS.archiveBytes + 128_000,
  uncompressedBytes: PORTABLE_PROJECT_LIMITS.archiveBytes + 128_000,
  entries: 2,
  metadataBytes: 64_000,
  pathLength: 80,
});

const BACKUP_ENTRY = "backup-record.json";
const PORTABLE_ENTRY = "portable-project.cyoa.zip";
const fixedDate = new Date("1980-01-01T00:00:00.000Z");

export interface RecoveryStatus {
  projectId: string;
  currentProjectFingerprint: string;
  currentSchemaVersion: number;
  supportedSchemaVersion: number;
  freshness: BackupFreshnessStatus;
  latestVerifiedBackup: ProjectBackupRecord | null;
  reminder: { visible: boolean; dismissedForCurrentVersion: boolean; snoozedUntil: string | null };
  lastVerificationFailure: { at: string; code: string } | null;
  backups: ProjectBackupRecord[];
  restores: ProjectRestoreRecord[];
}

export interface BackupPreview {
  record: ProjectBackupRecord;
  manifest: PortableManifest;
  projectName: string;
  conflict: boolean;
  verification: { verified: true; method: "isolated-portable-restore"; diagnostics: string[] };
}

export interface RecoveryServiceOptions {
  applicationVersion?: string | null;
  temporaryDirectoryRoot?: string;
  afterBackupCapture?: (capture: { projectId: string; projectFingerprint: string; portableBytes: Uint8Array }) => void | Promise<void>;
  createTemporaryDirectory?: (prefix: string) => Promise<string>;
  removeTemporaryDirectory?: (path: string) => Promise<void>;
  openIsolatedDatabase?: (path: string) => StoryDatabase;
  encodeBackupArchive?: (record: ProjectBackupRecord, portableBytes: Uint8Array) => Uint8Array;
}

export class RecoveryService {
  private readonly recovery: RecoveryRepository;
  private readonly projects: ProjectRepository;
  private readonly temporaryDirectoryRoot: string;
  private readonly applicationVersion: string | null;

  public constructor(
    private readonly database: StoryDatabase,
    private readonly portable: PortableProjectRepository,
    private readonly publication: PublicationExportService,
    private readonly options: RecoveryServiceOptions = {},
  ) {
    this.recovery = new RecoveryRepository(database);
    this.projects = new ProjectRepository(database);
    this.temporaryDirectoryRoot = options.temporaryDirectoryRoot ?? tmpdir();
    this.applicationVersion = options.applicationVersion ?? null;
  }

  async createVerifiedBackup(projectId: string): Promise<{ bytes: Uint8Array; record: ProjectBackupRecord; filename: string }> {
    const capturedAt = new Date().toISOString();
    let capture: ReturnType<PublicationExportService["exportPortable"]>;
    try { capture = this.publication.exportPortable(projectId); }
    catch (error) { throw normalizeRecoveryError(error, "backup_export_failed"); }
    try {
      await this.options.afterBackupCapture?.({
        projectId,
        projectFingerprint: capture.manifest.projectFingerprint,
        portableBytes: capture.bytes.slice(),
      });
      const verification = await this.verifyPortable(capture.bytes);
      if (verification.manifest.projectId !== projectId
        || verification.manifest.projectFingerprint !== capture.manifest.projectFingerprint) {
        throw new RecoveryOperationError("backup_semantic_mismatch", "The isolated project identity differs from the captured project.");
      }
      const record = ProjectBackupRecordSchema.parse({
        schemaId: PROJECT_BACKUP_RECORD_SCHEMA_ID,
        schemaVersion: PROJECT_BACKUP_RECORD_SCHEMA_VERSION,
        backupId: randomUUID(),
        projectId,
        gameId: projectId,
        portableSchemaId: capture.manifest.schemaId,
        portableSchemaVersion: capture.manifest.schemaVersion,
        portableProjectFingerprint: capture.manifest.projectFingerprint,
        portableArchiveSha256: sha256(capture.bytes),
        portableArchiveByteCount: capture.bytes.byteLength,
        sourceSqliteSchemaVersion: databaseSchemaVersion(this.database),
        applicationVersion: this.applicationVersion,
        createdAt: capturedAt,
        verificationStatus: "verified",
        verifiedAt: new Date().toISOString(),
        verificationMethod: "isolated-portable-restore",
        verificationMethodVersion: 1,
        restoredSemanticFingerprint: verification.manifest.projectFingerprint,
        verificationDiagnostics: [{ code: "isolated_round_trip_verified", message: "Isolated restore, domain validation, integrity check, and canonical semantic comparison succeeded." }],
        sourceChangeFingerprint: capture.manifest.projectFingerprint,
      });
      const bytes = (this.options.encodeBackupArchive ?? encodeBackup)(record, capture.bytes);
      transaction(this.database, () => {
        this.recovery.insertVerifiedBackup(record);
        this.recovery.clearVerificationFailure(projectId);
      });
      return { bytes, record, filename: safeBackupFilename(verification.projectName, record.backupId) };
    } catch (error) {
      const normalized = normalizeRecoveryError(error, "backup_verification_failed");
      try { this.recovery.recordVerificationFailure(projectId, capture.manifest.projectFingerprint, normalized.code); }
      catch { /* The primary failure remains authoritative. */ }
      throw normalized;
    }
  }

  async previewBackup(bytes: Uint8Array): Promise<BackupPreview> {
    const parsed = parseBackup(bytes);
    const verification = await this.verifyPortable(parsed.portableBytes);
    assertRecordMatchesPortable(parsed.record, verification.manifest, parsed.portableBytes);
    const conflict = Boolean(this.projects.get(parsed.record.projectId));
    return {
      record: parsed.record,
      manifest: verification.manifest,
      projectName: verification.projectName,
      conflict,
      verification: { verified: true, method: "isolated-portable-restore", diagnostics: verification.diagnostics },
    };
  }

  async restoreBackup(bytes: Uint8Array): Promise<{ projectId: string; backupId: string; restore: ProjectRestoreRecord }> {
    // Preview results are never trusted as authority: parse and verify these exact bytes again.
    const parsed = parseBackup(bytes);
    const verification = await this.verifyPortable(parsed.portableBytes);
    assertRecordMatchesPortable(parsed.record, verification.manifest, parsed.portableBytes);
    const restore = ProjectRestoreRecordSchema.parse({
      schemaId: PROJECT_RESTORE_RECORD_SCHEMA_ID,
      schemaVersion: PROJECT_RESTORE_RECORD_SCHEMA_VERSION,
      restoreId: randomUUID(),
      projectId: parsed.record.projectId,
      backupId: parsed.record.backupId,
      sourceProjectId: parsed.record.projectId,
      portableProjectFingerprint: parsed.record.portableProjectFingerprint,
      restoredSemanticFingerprint: verification.manifest.projectFingerprint,
      restoredAt: new Date().toISOString(),
      outcome: "restored",
      diagnostics: [{ code: "atomic_restore_verified", message: "The authoritative backup bytes were revalidated and restored atomically." }],
    });
    try {
      transaction(this.database, () => {
        this.portable.importRowsInTransaction(verification.rows, validatePortableAuthoringProject);
        this.recovery.insertVerifiedBackup(parsed.record);
        this.recovery.insertRestore(restore);
        const restored = this.publication.exportPortable(parsed.record.projectId);
        if (restored.manifest.projectFingerprint !== parsed.record.portableProjectFingerprint
          || sha256(restored.bytes) !== parsed.record.portableArchiveSha256) {
          throw new RecoveryOperationError("restore_semantic_mismatch", "The published project differs from the verified backup.");
        }
      });
    } catch (error) {
      throw normalizeRecoveryError(error, "restore_failed");
    }
    return { projectId: parsed.record.projectId, backupId: parsed.record.backupId, restore };
  }

  status(projectId: string): RecoveryStatus {
    if (!this.projects.get(projectId)) throw new RecoveryOperationError("project_not_found", "Project not found.");
    const current = this.publication.exportPortable(projectId).manifest.projectFingerprint;
    const latest = this.recovery.latestVerifiedBackup(projectId) ?? null;
    const state = this.recovery.getState(projectId);
    const currentSchemaVersion = databaseSchemaVersion(this.database);
    let freshness: BackupFreshnessStatus;
    if (state?.lastVerificationFailureFingerprint === current
      && (!latest || Date.parse(state.lastVerificationFailureAt ?? "") > Date.parse(latest.verifiedAt))) {
      freshness = "backup-verification-failed";
    } else if (!latest) freshness = "never-backed-up";
    else if (latest.sourceSqliteSchemaVersion !== currentSchemaVersion
      || latest.applicationVersion !== this.applicationVersion) freshness = "schema-upgrade-since-backup";
    else if (latest.sourceChangeFingerprint !== current) freshness = "changes-since-backup";
    else freshness = "current";
    const dismissed = state?.reminderDismissedForFingerprint === current;
    const snoozedUntil = state?.reminderSnoozedUntil ?? null;
    const snoozed = snoozedUntil !== null && Date.parse(snoozedUntil) > Date.now();
    return {
      projectId,
      currentProjectFingerprint: current,
      currentSchemaVersion,
      supportedSchemaVersion: CURRENT_SCHEMA_VERSION,
      freshness,
      latestVerifiedBackup: latest,
      reminder: { visible: freshness !== "current" && !dismissed && !snoozed, dismissedForCurrentVersion: dismissed, snoozedUntil },
      lastVerificationFailure: state?.lastVerificationFailureAt && state.lastVerificationFailureCode
        ? { at: state.lastVerificationFailureAt, code: state.lastVerificationFailureCode } : null,
      backups: this.recovery.listBackups(projectId),
      restores: this.recovery.listRestores(projectId),
    };
  }

  updateReminder(projectId: string, input: { action: "dismiss-current" | "snooze" | "reset"; days?: number }): RecoveryStatus {
    const current = this.status(projectId).currentProjectFingerprint;
    if (input.action === "dismiss-current") this.recovery.setReminder(projectId, { dismissedForFingerprint: current, snoozedUntil: null });
    else if (input.action === "reset") this.recovery.setReminder(projectId, { dismissedForFingerprint: null, snoozedUntil: null });
    else {
      const days = input.days ?? 1;
      if (!Number.isInteger(days) || days < 1 || days > 7) throw new RecoveryOperationError("reminder_policy_invalid", "Backup reminders may be snoozed for one through seven days.");
      this.recovery.setReminder(projectId, { dismissedForFingerprint: null, snoozedUntil: new Date(Date.now() + days * 86_400_000).toISOString() });
    }
    return this.status(projectId);
  }

  integrityCheck() {
    return { compatibility: databaseCompatibilityStatus(this.database), integrity: runDatabaseIntegrityCheck(this.database) };
  }

  deletionPreview(projectId: string): RecoveryStatus {
    return this.status(projectId);
  }

  deleteProject(projectId: string, confirmation: { projectId: string; projectFingerprint: string }): void {
    const status = this.status(projectId);
    if (confirmation.projectId !== projectId || confirmation.projectFingerprint !== status.currentProjectFingerprint) {
      throw new RecoveryOperationError("delete_confirmation_stale", "Project deletion confirmation does not match the current project identity and content.");
    }
    transaction(this.database, () => this.projects.remove(projectId));
  }

  private async verifyPortable(portableBytes: Uint8Array): Promise<{
    manifest: PortableManifest;
    rows: ReturnType<PublicationExportService["parsePortableArchive"]>["rows"];
    projectName: string;
    diagnostics: string[];
  }> {
    const source = this.publication.parsePortableArchive(portableBytes);
    const directory = await (this.options.createTemporaryDirectory ?? mkdtemp)(join(this.temporaryDirectoryRoot, "cyoa-recovery-"));
    const databasePath = join(directory, "reconstruction.sqlite");
    let isolated: StoryDatabase | undefined;
    try {
      isolated = (this.options.openIsolatedDatabase ?? openDatabase)(databasePath);
      const isolatedPortable = new PortableProjectRepository(isolated);
      const isolatedPublication = new PublicationExportService(isolatedPortable, undefined);
      isolatedPortable.importRows(source.rows, validatePortableAuthoringProject);
      const integrity = runDatabaseIntegrityCheck(isolated);
      if (!integrity.ok) throw new RecoveryOperationError("isolated_integrity_failed", "The isolated reconstructed database did not pass SQLite quick_check.");
      const restored = isolatedPublication.exportPortable(source.rows.projectId);
      if (restored.manifest.projectFingerprint !== source.manifest.projectFingerprint
        || sha256(restored.bytes) !== sha256(portableBytes)) {
        throw new RecoveryOperationError("backup_semantic_mismatch", "Canonical re-export differs from the supplied portable project.");
      }
      return {
        manifest: source.manifest,
        rows: source.rows,
        projectName: String(source.rows.tables.projects[0]?.name ?? "Restored project"),
        diagnostics: ["Hostile archive validation passed", "Isolated SQLite reconstruction passed", "Domain and relationship validation passed", "Canonical semantic comparison passed"],
      };
    } finally {
      try { isolated?.close(); } catch { /* Cleanup remains best-effort. */ }
      if (this.options.removeTemporaryDirectory) await this.options.removeTemporaryDirectory(directory);
      else await rm(directory, { recursive: true, force: true });
    }
  }
}

export class RecoveryOperationError extends Error {
  public constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = "RecoveryOperationError";
  }
}

export function parseBackup(bytes: Uint8Array): { record: ProjectBackupRecord; portableBytes: Uint8Array } {
  if (bytes.byteLength > PROJECT_BACKUP_LIMITS.archiveBytes) throw new RecoveryOperationError("backup_too_large", "The backup exceeds the archive byte limit.");
  inspectBackupZip(bytes);
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); }
  catch (error) { throw new RecoveryOperationError("backup_archive_invalid", "The backup ZIP could not be decoded.", { cause: error }); }
  if (Object.keys(files).sort().join("\0") !== `${BACKUP_ENTRY}\0${PORTABLE_ENTRY}`) {
    throw new RecoveryOperationError("backup_entries_invalid", "The backup must contain exactly its verification record and portable project.");
  }
  const recordBytes = files[BACKUP_ENTRY]!;
  const portableBytes = files[PORTABLE_ENTRY]!;
  if (recordBytes.byteLength > PROJECT_BACKUP_LIMITS.metadataBytes) throw new RecoveryOperationError("backup_metadata_too_large", "Backup metadata exceeds its limit.");
  let raw: unknown;
  try { raw = JSON.parse(strFromU8(recordBytes)); }
  catch (error) { throw new RecoveryOperationError("backup_record_invalid", "Backup verification metadata is not valid JSON.", { cause: error }); }
  const parsed = ProjectBackupRecordSchema.safeParse(raw);
  if (!parsed.success) throw new RecoveryOperationError("backup_record_invalid", "Backup verification metadata does not match the supported strict schema.");
  assertRecordMatchesPortable(parsed.data, undefined, portableBytes);
  return { record: parsed.data, portableBytes };
}

function encodeBackup(record: ProjectBackupRecord, portableBytes: Uint8Array): Uint8Array {
  const recordBytes = strToU8(canonical(record));
  const bytes = zipSync({
    [BACKUP_ENTRY]: [recordBytes, { mtime: fixedDate, level: 9 }],
    [PORTABLE_ENTRY]: [portableBytes, { mtime: fixedDate, level: 0 }],
  });
  if (bytes.byteLength > PROJECT_BACKUP_LIMITS.archiveBytes) throw new RecoveryOperationError("backup_too_large", "The verified backup exceeds its archive byte limit.");
  return bytes;
}

function assertRecordMatchesPortable(record: ProjectBackupRecord, manifest: PortableManifest | undefined, portableBytes: Uint8Array): void {
  if (record.portableArchiveByteCount !== portableBytes.byteLength || record.portableArchiveSha256 !== sha256(portableBytes)) {
    throw new RecoveryOperationError("backup_hash_invalid", "The embedded portable project does not match the verified backup record.");
  }
  if (manifest && (manifest.projectId !== record.projectId || manifest.projectFingerprint !== record.portableProjectFingerprint
    || manifest.schemaId !== record.portableSchemaId || manifest.schemaVersion !== record.portableSchemaVersion)) {
    throw new RecoveryOperationError("backup_manifest_mismatch", "The backup record contradicts the embedded portable project manifest.");
  }
}

function inspectBackupZip(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    let end = -1;
    const minimum = Math.max(0, bytes.byteLength - 65_557);
    for (let offset = bytes.byteLength - 22; offset >= minimum; offset--) {
      if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
    }
    if (end < 0) throw new Error("missing-end-record");
    const disk = view.getUint16(end + 4, true);
    const centralDisk = view.getUint16(end + 6, true);
    const diskEntries = view.getUint16(end + 8, true);
    const entries = view.getUint16(end + 10, true);
    const centralBytes = view.getUint32(end + 12, true);
    const centralOffset = view.getUint32(end + 16, true);
    const commentBytes = view.getUint16(end + 20, true);
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== entries || entries !== PROJECT_BACKUP_LIMITS.entries
      || end + 22 + commentBytes !== bytes.byteLength || centralOffset + centralBytes !== end) throw new Error("central-directory");
    let total = 0;
    let offset = centralOffset;
    const names = new Set<string>();
    for (let index = 0; index < entries; index++) {
      if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("central-entry");
      const flags = view.getUint16(offset + 8, true);
      const compressed = view.getUint32(offset + 20, true);
      const size = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extra = view.getUint16(offset + 30, true);
      const comment = view.getUint16(offset + 32, true);
      const external = view.getUint32(offset + 38, true);
      const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      if (!name || name.length > PROJECT_BACKUP_LIMITS.pathLength || name.includes("\\") || name.startsWith("/")
        || /^[A-Za-z]:/.test(name) || name.split("/").includes("..") || names.has(name)) throw new Error("path");
      if ((flags & 1) !== 0) throw new Error("encrypted");
      if (((external >>> 16) & 0o170000) === 0o120000) throw new Error("symlink");
      names.add(name);
      total += size;
      if (compressed > PROJECT_BACKUP_LIMITS.archiveBytes || total > PROJECT_BACKUP_LIMITS.uncompressedBytes) throw new Error("size");
      offset += 46 + nameLength + extra + comment;
    }
    if (offset !== end || !names.has(BACKUP_ENTRY) || !names.has(PORTABLE_ENTRY)) throw new Error("entries");
  } catch (error) {
    throw new RecoveryOperationError("backup_archive_hostile", "The backup contains an unsafe ZIP entry.", { cause: error });
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeBackupFilename(name: string, backupId: string): string {
  const base = name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "cyoa-project";
  return `${base}-${backupId.slice(0, 8)}.cyoa-backup.zip`;
}

function normalizeRecoveryError(error: unknown, fallbackCode: string): RecoveryOperationError {
  if (error instanceof RecoveryOperationError) return error;
  const message = String((error as { message?: unknown })?.message ?? error ?? "Recovery operation failed");
  const knownCode = message.match(/^([a-z0-9_]+):/)?.[1];
  return new RecoveryOperationError(knownCode ?? fallbackCode, "The recovery operation failed safely; canonical project data was not partially changed.", { cause: error });
}
