import { z } from "zod";

export const PROJECT_BACKUP_RECORD_SCHEMA_ID = "cyoa.project-backup-record" as const;
export const PROJECT_BACKUP_RECORD_SCHEMA_VERSION = 1 as const;
export const PROJECT_RESTORE_RECORD_SCHEMA_ID = "cyoa.project-restore-record" as const;
export const PROJECT_RESTORE_RECORD_SCHEMA_VERSION = 1 as const;

const FingerprintSchema = z.string().regex(/^[0-9a-f]{32}$/);
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

export const RecoveryDiagnosticSchema = z.object({
  code: z.string().min(1).max(120),
  message: z.string().min(1).max(1_000),
}).strict();

export const ProjectBackupRecordSchema = z.object({
  schemaId: z.literal(PROJECT_BACKUP_RECORD_SCHEMA_ID),
  schemaVersion: z.literal(PROJECT_BACKUP_RECORD_SCHEMA_VERSION),
  backupId: z.string().uuid(),
  projectId: z.string().min(1).max(200),
  gameId: z.string().min(1).max(200),
  portableSchemaId: z.literal("cyoa.portable-project"),
  portableSchemaVersion: z.literal(1),
  portableProjectFingerprint: FingerprintSchema,
  portableArchiveSha256: Sha256Schema,
  portableArchiveByteCount: z.number().int().positive().max(128_000_000),
  sourceSqliteSchemaVersion: z.number().int().min(4).max(10_000),
  applicationVersion: z.string().min(1).max(120).nullable(),
  createdAt: TimestampSchema,
  verificationStatus: z.literal("verified"),
  verifiedAt: TimestampSchema,
  verificationMethod: z.literal("isolated-portable-restore"),
  verificationMethodVersion: z.literal(1),
  restoredSemanticFingerprint: FingerprintSchema,
  verificationDiagnostics: z.array(RecoveryDiagnosticSchema).max(20),
  sourceChangeFingerprint: FingerprintSchema,
}).strict().superRefine((record, context) => {
  if (record.gameId !== record.projectId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["gameId"], message: "Backup game identity must match portable project identity" });
  }
  if (record.portableProjectFingerprint !== record.restoredSemanticFingerprint
    || record.portableProjectFingerprint !== record.sourceChangeFingerprint) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["restoredSemanticFingerprint"], message: "Verified semantic identities differ" });
  }
  if (Date.parse(record.verifiedAt) < Date.parse(record.createdAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["verifiedAt"], message: "Verification predates backup creation" });
  }
});

export const ProjectRestoreRecordSchema = z.object({
  schemaId: z.literal(PROJECT_RESTORE_RECORD_SCHEMA_ID),
  schemaVersion: z.literal(PROJECT_RESTORE_RECORD_SCHEMA_VERSION),
  restoreId: z.string().uuid(),
  projectId: z.string().min(1).max(200),
  backupId: z.string().uuid(),
  sourceProjectId: z.string().min(1).max(200),
  portableProjectFingerprint: FingerprintSchema,
  restoredSemanticFingerprint: FingerprintSchema,
  restoredAt: TimestampSchema,
  outcome: z.literal("restored"),
  diagnostics: z.array(RecoveryDiagnosticSchema).max(20),
}).strict().superRefine((record, context) => {
  if (record.projectId !== record.sourceProjectId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["projectId"], message: "Portable restore must preserve project identity" });
  }
  if (record.portableProjectFingerprint !== record.restoredSemanticFingerprint) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["restoredSemanticFingerprint"], message: "Restored semantic identity differs" });
  }
});

export const BackupFreshnessStatusSchema = z.enum([
  "never-backed-up",
  "current",
  "changes-since-backup",
  "schema-upgrade-since-backup",
  "backup-verification-failed",
  "unknown",
]);

export type RecoveryDiagnostic = z.infer<typeof RecoveryDiagnosticSchema>;
export type ProjectBackupRecord = z.infer<typeof ProjectBackupRecordSchema>;
export type ProjectRestoreRecord = z.infer<typeof ProjectRestoreRecordSchema>;
export type BackupFreshnessStatus = z.infer<typeof BackupFreshnessStatusSchema>;
