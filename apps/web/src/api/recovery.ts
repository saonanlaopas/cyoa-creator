export interface BackupRecord {
  schemaId: "cyoa.project-backup-record";
  schemaVersion: 1;
  backupId: string;
  projectId: string;
  gameId: string;
  portableSchemaId: "cyoa.portable-project";
  portableSchemaVersion: 1;
  portableProjectFingerprint: string;
  portableArchiveSha256: string;
  portableArchiveByteCount: number;
  sourceSqliteSchemaVersion: number;
  applicationVersion: string | null;
  createdAt: string;
  verificationStatus: "verified";
  verifiedAt: string;
  verificationMethod: "isolated-portable-restore";
  verificationMethodVersion: 1;
  restoredSemanticFingerprint: string;
  verificationDiagnostics: Array<{ code: string; message: string }>;
  sourceChangeFingerprint: string;
}

export interface RestoreRecord {
  restoreId: string;
  projectId: string;
  backupId: string;
  restoredAt: string;
  outcome: "restored";
}

export interface RecoveryStatus {
  projectId: string;
  currentProjectFingerprint: string;
  currentSchemaVersion: number;
  supportedSchemaVersion: number;
  freshness: "never-backed-up" | "current" | "changes-since-backup" | "schema-upgrade-since-backup" | "backup-verification-failed" | "unknown";
  latestVerifiedBackup: BackupRecord | null;
  reminder: { visible: boolean; dismissedForCurrentVersion: boolean; snoozedUntil: string | null };
  lastVerificationFailure: { at: string; code: string } | null;
  backups: BackupRecord[];
  restores: RestoreRecord[];
}

export interface BackupPreview {
  record: BackupRecord;
  manifest: {
    projectId: string;
    projectFingerprint: string;
    historyMode: string;
    counts: Record<string, number>;
    exclusions: string[];
  };
  projectName: string;
  conflict: boolean;
  verification: { verified: true; method: "isolated-portable-restore"; diagnostics: string[] };
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Recovery request failed");
  return body as T;
}

const root = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/recovery`;

export const loadRecoveryStatus = async (projectId: string) => json<RecoveryStatus>(await fetch(root(projectId)));

export async function createAndDownloadVerifiedBackup(projectId: string): Promise<{ backupId: string; fingerprint: string }> {
  const response = await fetch(`${root(projectId)}/backups`, { method: "POST" });
  if (!response.ok) {
    const body = await response.json() as { error?: string };
    throw new Error(body.error ?? "Verified backup creation failed");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `${projectId}.cyoa-backup.zip`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return {
    backupId: response.headers.get("x-cyoa-backup-id") ?? "verified-backup",
    fingerprint: response.headers.get("x-cyoa-artifact-fingerprint") ?? "unknown",
  };
}

async function backupUpload<T>(path: "preview" | "restore", file: File): Promise<T> {
  const data = new FormData(); data.append("file", file);
  return json<T>(await fetch(`/api/recovery/backups/${path}`, { method: "POST", body: data }));
}

export const previewProjectBackup = (file: File) => backupUpload<BackupPreview>("preview", file);
export const restoreProjectBackup = (file: File) => backupUpload<{ projectId: string; backupId: string; restore: RestoreRecord }>("restore", file);

export const updateBackupReminder = async (projectId: string, input: { action: "dismiss-current" | "snooze" | "reset"; days?: number }) =>
  json<RecoveryStatus>(await fetch(`${root(projectId)}/reminder`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  }));

export const runDatabaseQuickCheck = async () => json<{
  compatibility: { compatible: true; schemaVersion: number; supportedSchemaVersion: number; integrityStatus: "not-run" };
  integrity: { ok: boolean; method: "quick_check"; checkedAt: string; results: string[] };
}>(await fetch("/api/recovery/database/integrity", { method: "POST" }));

export const permanentlyDeleteProject = async (projectId: string, projectFingerprint: string): Promise<void> => {
  const response = await fetch(`${root(projectId)}/permanent-delete`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, projectFingerprint }),
  });
  if (!response.ok) {
    const body = await response.json() as { error?: string };
    throw new Error(body.error ?? "Permanent deletion failed");
  }
};
