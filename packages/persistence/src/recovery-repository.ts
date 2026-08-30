import {
  ProjectBackupRecordSchema,
  ProjectRestoreRecordSchema,
  type ProjectBackupRecord,
  type ProjectRestoreRecord,
} from "@story-to-cyoa/domain";
import type { StoryDatabase } from "./database.js";

interface BackupRow {
  id: string;
  project_id: string;
  schema_id: string;
  schema_version: number;
  game_id: string;
  portable_schema_id: string;
  portable_schema_version: number;
  portable_project_fingerprint: string;
  portable_archive_sha256: string;
  portable_archive_byte_count: number;
  source_sqlite_schema_version: number;
  application_version: string | null;
  created_at: string;
  verification_status: "verified";
  verified_at: string;
  verification_method: "isolated-portable-restore";
  verification_method_version: 1;
  restored_semantic_fingerprint: string;
  verification_diagnostics_json: string;
  source_change_fingerprint: string;
}

interface RestoreRow {
  id: string;
  project_id: string;
  backup_id: string;
  schema_id: string;
  schema_version: number;
  source_project_id: string;
  portable_project_fingerprint: string;
  restored_semantic_fingerprint: string;
  restored_at: string;
  outcome: "restored";
  diagnostics_json: string;
}

export class RecoveryRepository {
  public constructor(private readonly database: StoryDatabase) {}

  insertVerifiedBackup(value: ProjectBackupRecord): ProjectBackupRecord {
    const record = ProjectBackupRecordSchema.parse(value);
    this.database.prepare(`INSERT INTO project_backup_records (
      id, project_id, schema_id, schema_version, game_id, portable_schema_id, portable_schema_version,
      portable_project_fingerprint, portable_archive_sha256, portable_archive_byte_count,
      source_sqlite_schema_version, application_version, created_at, verification_status, verified_at,
      verification_method, verification_method_version, restored_semantic_fingerprint,
      verification_diagnostics_json, source_change_fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        record.backupId, record.projectId, record.schemaId, record.schemaVersion, record.gameId,
        record.portableSchemaId, record.portableSchemaVersion, record.portableProjectFingerprint,
        record.portableArchiveSha256, record.portableArchiveByteCount, record.sourceSqliteSchemaVersion,
        record.applicationVersion, record.createdAt, record.verificationStatus, record.verifiedAt,
        record.verificationMethod, record.verificationMethodVersion, record.restoredSemanticFingerprint,
        JSON.stringify(record.verificationDiagnostics), record.sourceChangeFingerprint,
      );
    return this.getBackup(record.projectId, record.backupId)!;
  }

  insertRestore(value: ProjectRestoreRecord): ProjectRestoreRecord {
    const record = ProjectRestoreRecordSchema.parse(value);
    const backup = this.database.prepare(`SELECT project_id, portable_project_fingerprint
      FROM project_backup_records WHERE id = ?`).get(record.backupId) as {
        project_id: string;
        portable_project_fingerprint: string;
      } | undefined;
    if (!backup || backup.project_id !== record.projectId
      || backup.portable_project_fingerprint !== record.portableProjectFingerprint) {
      throw new Error("Restore metadata does not match its exact verified backup");
    }
    this.database.prepare(`INSERT INTO project_restore_records (
      id, project_id, backup_id, schema_id, schema_version, source_project_id,
      portable_project_fingerprint, restored_semantic_fingerprint, restored_at, outcome, diagnostics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        record.restoreId, record.projectId, record.backupId, record.schemaId, record.schemaVersion,
        record.sourceProjectId, record.portableProjectFingerprint, record.restoredSemanticFingerprint,
        record.restoredAt, record.outcome, JSON.stringify(record.diagnostics),
      );
    return this.getRestore(record.projectId, record.restoreId)!;
  }

  getBackup(projectId: string, backupId: string): ProjectBackupRecord | undefined {
    const row = this.database.prepare("SELECT * FROM project_backup_records WHERE project_id = ? AND id = ?")
      .get(projectId, backupId) as BackupRow | undefined;
    return row ? mapBackup(row) : undefined;
  }

  latestVerifiedBackup(projectId: string): ProjectBackupRecord | undefined {
    const row = this.database.prepare(`SELECT * FROM project_backup_records WHERE project_id = ?
      ORDER BY verified_at DESC, id DESC LIMIT 1`).get(projectId) as BackupRow | undefined;
    return row ? mapBackup(row) : undefined;
  }

  listBackups(projectId: string, limit = 50): ProjectBackupRecord[] {
    const bounded = boundedLimit(limit);
    return (this.database.prepare(`SELECT * FROM project_backup_records WHERE project_id = ?
      ORDER BY verified_at DESC, id DESC LIMIT ?`).all(projectId, bounded) as unknown as BackupRow[]).map(mapBackup);
  }

  getRestore(projectId: string, restoreId: string): ProjectRestoreRecord | undefined {
    const row = this.database.prepare("SELECT * FROM project_restore_records WHERE project_id = ? AND id = ?")
      .get(projectId, restoreId) as RestoreRow | undefined;
    return row ? mapRestore(row) : undefined;
  }

  listRestores(projectId: string, limit = 50): ProjectRestoreRecord[] {
    const bounded = boundedLimit(limit);
    return (this.database.prepare(`SELECT * FROM project_restore_records WHERE project_id = ?
      ORDER BY restored_at DESC, id DESC LIMIT ?`).all(projectId, bounded) as unknown as RestoreRow[]).map(mapRestore);
  }

  getState(projectId: string): RecoveryStateRecord | undefined {
    const row = this.database.prepare("SELECT * FROM project_recovery_state WHERE project_id = ?")
      .get(projectId) as RecoveryStateRow | undefined;
    return row ? mapState(row) : undefined;
  }

  setReminder(projectId: string, input: { dismissedForFingerprint: string | null; snoozedUntil: string | null }): RecoveryStateRecord {
    if (input.dismissedForFingerprint !== null && !/^[0-9a-f]{32}$/.test(input.dismissedForFingerprint)) {
      throw new Error("Recovery reminder fingerprint is invalid");
    }
    if (input.snoozedUntil !== null && !Number.isFinite(Date.parse(input.snoozedUntil))) {
      throw new Error("Recovery reminder snooze time is invalid");
    }
    const now = new Date().toISOString();
    this.database.prepare(`INSERT INTO project_recovery_state (
      project_id, reminder_dismissed_for_fingerprint, reminder_snoozed_until, updated_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      reminder_dismissed_for_fingerprint = excluded.reminder_dismissed_for_fingerprint,
      reminder_snoozed_until = excluded.reminder_snoozed_until,
      updated_at = excluded.updated_at`)
      .run(projectId, input.dismissedForFingerprint, input.snoozedUntil, now);
    return this.getState(projectId)!;
  }

  recordVerificationFailure(projectId: string, sourceFingerprint: string, code: string): RecoveryStateRecord {
    if (!/^[0-9a-f]{32}$/.test(sourceFingerprint) || !code || code.length > 120) {
      throw new Error("Backup verification failure metadata is invalid");
    }
    const now = new Date().toISOString();
    this.database.prepare(`INSERT INTO project_recovery_state (
      project_id, last_verification_failure_at, last_verification_failure_fingerprint,
      last_verification_failure_code, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      last_verification_failure_at = excluded.last_verification_failure_at,
      last_verification_failure_fingerprint = excluded.last_verification_failure_fingerprint,
      last_verification_failure_code = excluded.last_verification_failure_code,
      updated_at = excluded.updated_at`)
      .run(projectId, now, sourceFingerprint, code, now);
    return this.getState(projectId)!;
  }

  clearVerificationFailure(projectId: string): void {
    this.database.prepare(`UPDATE project_recovery_state SET
      last_verification_failure_at = NULL,
      last_verification_failure_fingerprint = NULL,
      last_verification_failure_code = NULL,
      updated_at = ? WHERE project_id = ?`).run(new Date().toISOString(), projectId);
  }
}

interface RecoveryStateRow {
  project_id: string;
  reminder_dismissed_for_fingerprint: string | null;
  reminder_snoozed_until: string | null;
  last_verification_failure_at: string | null;
  last_verification_failure_fingerprint: string | null;
  last_verification_failure_code: string | null;
  updated_at: string;
}

export interface RecoveryStateRecord {
  projectId: string;
  reminderDismissedForFingerprint: string | null;
  reminderSnoozedUntil: string | null;
  lastVerificationFailureAt: string | null;
  lastVerificationFailureFingerprint: string | null;
  lastVerificationFailureCode: string | null;
  updatedAt: string;
}

function mapState(row: RecoveryStateRow): RecoveryStateRecord {
  return {
    projectId: row.project_id,
    reminderDismissedForFingerprint: row.reminder_dismissed_for_fingerprint,
    reminderSnoozedUntil: row.reminder_snoozed_until,
    lastVerificationFailureAt: row.last_verification_failure_at,
    lastVerificationFailureFingerprint: row.last_verification_failure_fingerprint,
    lastVerificationFailureCode: row.last_verification_failure_code,
    updatedAt: row.updated_at,
  };
}

function mapBackup(row: BackupRow): ProjectBackupRecord {
  return ProjectBackupRecordSchema.parse({
    schemaId: row.schema_id,
    schemaVersion: row.schema_version,
    backupId: row.id,
    projectId: row.project_id,
    gameId: row.game_id,
    portableSchemaId: row.portable_schema_id,
    portableSchemaVersion: row.portable_schema_version,
    portableProjectFingerprint: row.portable_project_fingerprint,
    portableArchiveSha256: row.portable_archive_sha256,
    portableArchiveByteCount: row.portable_archive_byte_count,
    sourceSqliteSchemaVersion: row.source_sqlite_schema_version,
    applicationVersion: row.application_version,
    createdAt: row.created_at,
    verificationStatus: row.verification_status,
    verifiedAt: row.verified_at,
    verificationMethod: row.verification_method,
    verificationMethodVersion: row.verification_method_version,
    restoredSemanticFingerprint: row.restored_semantic_fingerprint,
    verificationDiagnostics: JSON.parse(row.verification_diagnostics_json),
    sourceChangeFingerprint: row.source_change_fingerprint,
  });
}

function mapRestore(row: RestoreRow): ProjectRestoreRecord {
  return ProjectRestoreRecordSchema.parse({
    schemaId: row.schema_id,
    schemaVersion: row.schema_version,
    restoreId: row.id,
    projectId: row.project_id,
    backupId: row.backup_id,
    sourceProjectId: row.source_project_id,
    portableProjectFingerprint: row.portable_project_fingerprint,
    restoredSemanticFingerprint: row.restored_semantic_fingerprint,
    restoredAt: row.restored_at,
    outcome: row.outcome,
    diagnostics: JSON.parse(row.diagnostics_json),
  });
}

function boundedLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Recovery history limit is invalid");
  return Math.min(value, 100);
}
