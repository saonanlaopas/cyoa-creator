import { useEffect, useRef, useState } from "react";
import {
  createAndDownloadVerifiedBackup,
  loadRecoveryStatus,
  permanentlyDeleteProject,
  previewProjectBackup,
  restoreProjectBackup,
  runDatabaseQuickCheck,
  updateBackupReminder,
  type BackupPreview,
  type RecoveryStatus,
} from "../../api/recovery.js";

export function RecoveryWorkspace({ projectId, onProjectDeleted, onProjectRestored }: {
  projectId: string;
  onProjectDeleted: () => void | Promise<void>;
  onProjectRestored: (projectId: string) => void | Promise<void>;
}) {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<Awaited<ReturnType<typeof runDatabaseQuickCheck>> | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteOpener = useRef<HTMLButtonElement>(null);
  const deleteInput = useRef<HTMLInputElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);

  const refresh = async () => setStatus(await loadRecoveryStatus(projectId));
  useEffect(() => {
    setMessage(null); setDeleteConfirmation("");
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [projectId]);
  useEffect(() => {
    const element = deleteDialog.current;
    if (!deleteDialogOpen || !element) return;
    if (typeof element.showModal === "function" && !element.open) element.showModal();
    else element.setAttribute("open", "");
    window.setTimeout(() => deleteInput.current?.focus(), 0);
    return () => { if (element.open && typeof element.close === "function") element.close(); };
  }, [deleteDialogOpen]);

  const perform = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage(null);
    try { await operation(); } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };

  return <section className="recovery-workspace" aria-label="Backup and recovery">
    <header className="artifact-header">
      <div>
        <p className="eyebrow">Foundation 8A recovery</p>
        <h1>Backup &amp; recovery</h1>
        <p>Verified portable recovery, compatibility diagnostics, and deliberate permanent deletion.</p>
      </div>
      <button disabled={busy} onClick={() => void refresh().catch((error: Error) => setMessage(error.message))}>Refresh status</button>
    </header>
    {message && <RecoveryMessage message={message} busy={busy} />}

    <section className="brief-section recovery-status">
      <h2>Current protection</h2>
      {!status ? <p>Loading backup state…</p> : <>
        <p className={status.freshness === "current" ? "status good" : "warning"}>{freshnessText(status)}</p>
        <dl className="simulation-metadata">
          <div><dt>Current semantic fingerprint</dt><dd>{status.currentProjectFingerprint}</dd></div>
          <div><dt>SQLite schema</dt><dd>v{status.currentSchemaVersion} · supported v{status.supportedSchemaVersion}</dd></div>
          <div><dt>Latest verified backup</dt><dd>{status.latestVerifiedBackup ? `${status.latestVerifiedBackup.backupId} · ${formatTime(status.latestVerifiedBackup.verifiedAt)}` : "None"}</dd></div>
          <div><dt>Verification state</dt><dd>{status.latestVerifiedBackup ? "Verified by isolated restore" : "No verified protection recorded"}</dd></div>
        </dl>
        <div className="artifact-actions">
          <button className="primary" disabled={busy} onClick={() => void perform(async () => {
            setMessage("Generating the backup and validating an isolated restored copy...");
            const result = await createAndDownloadVerifiedBackup(projectId);
            await refresh();
            setMessage(`Backup ${result.backupId} was verified and its browser download was initiated. Confirm that your browser retained it in durable storage.`);
          })}>Create, verify &amp; download backup</button>
          {status.reminder.visible && <>
            <button disabled={busy} onClick={() => void perform(async () => { setStatus(await updateBackupReminder(projectId, { action: "snooze", days: 1 })); })}>Snooze 1 day</button>
            <button disabled={busy} onClick={() => void perform(async () => { setStatus(await updateBackupReminder(projectId, { action: "dismiss-current" })); })}>Dismiss for this version</button>
          </>}
        </div>
        <p><small>A verified server-side creation does not prove the browser kept, moved, synchronized, or can later reopen the downloaded file.</small></p>
      </>}
    </section>

    <BackupRestorePanel busy={busy} setBusy={setBusy} setMessage={setMessage} onRestored={onProjectRestored} />

    <section className="brief-section">
      <h2>Database compatibility</h2>
      <p>The app checks compatibility at startup. The bounded SQLite <code>quick_check</code> runs only when you request it here.</p>
      <button disabled={busy} onClick={() => void perform(async () => {
        const result = await runDatabaseQuickCheck(); setIntegrity(result);
        setMessage(result.integrity.ok ? "SQLite quick_check passed." : "SQLite quick_check reported a problem.");
      })}>Run database quick_check</button>
      {integrity && <dl className="simulation-metadata">
        <div><dt>Result</dt><dd>{integrity.integrity.ok ? "OK" : "Attention required"}</dd></div>
        <div><dt>Schema</dt><dd>v{integrity.compatibility.schemaVersion}</dd></div>
        <div><dt>Checked</dt><dd>{formatTime(integrity.integrity.checkedAt)}</dd></div>
        <div><dt>Diagnostics</dt><dd>{integrity.integrity.results.join("; ")}</dd></div>
      </dl>}
    </section>

    {status && <section className="brief-section recovery-history">
      <h2>Bounded recovery history</h2>
      <p>{status.backups.length} verified backup record(s) · {status.restores.length} restore record(s). Archive bodies are not stored in SQLite.</p>
      {status.backups.slice(0, 10).map((record) => <article key={record.backupId}>
        <strong>{record.backupId}</strong>
        <small>{formatTime(record.verifiedAt)} · {record.portableArchiveByteCount.toLocaleString()} bytes · schema v{record.sourceSqliteSchemaVersion}</small>
        <code>{record.portableProjectFingerprint}</code>
      </article>)}
    </section>}

    {status && <section className="brief-section danger-zone">
      <h2>Permanent deletion</h2>
      <p>This permanently removes the project and its project-owned history. It does not create a backup automatically.</p>
      <p>{freshnessText(status)}</p>
      <button ref={deleteOpener} onClick={() => {
        setDeleteDialogOpen(true);
      }}>Review permanent deletion</button>
      {deleteDialogOpen && <dialog ref={deleteDialog} className="recovery-deletion-dialog" aria-modal="true" aria-labelledby="permanent-deletion-title"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
          )];
          const first = focusable[0]; const last = focusable.at(-1);
          if (!first || !last) return;
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus();
          }
        }}
        onCancel={(event) => { event.preventDefault(); setDeleteDialogOpen(false); setDeleteConfirmation(""); window.setTimeout(() => deleteOpener.current?.focus(), 0); }}>
        <h3 id="permanent-deletion-title">Permanently delete this project?</h3>
        <p>{freshnessText(status)}</p>
        <p>This action is destructive and does not create a backup automatically.</p>
        <label>Type the stable project ID to confirm
          <input ref={deleteInput} aria-label="Permanent deletion confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={projectId} />
        </label>
        <div className="artifact-actions">
          <button onClick={() => {
            setDeleteDialogOpen(false); setDeleteConfirmation("");
            window.setTimeout(() => deleteOpener.current?.focus(), 0);
          }}>Cancel deletion</button>
          <button disabled={busy || deleteConfirmation !== projectId} onClick={() => void perform(async () => {
            await permanentlyDeleteProject(projectId, status.currentProjectFingerprint);
            await onProjectDeleted();
          })}>Permanently delete project</button>
        </div>
      </dialog>}
    </section>}
  </section>;
}

export function GlobalRestorePanel({ onRestored }: { onRestored: (projectId: string) => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return <section className="panel global-restore" aria-label="Restore project backup">
    <h2>Restore a verified project backup</h2>
    <p>Available even when no project is open. Preview is write-free; restore preserves the stable ID and never overwrites a collision.</p>
    {message && <RecoveryMessage message={message} busy={busy} />}
    <BackupRestorePanel busy={busy} setBusy={setBusy} setMessage={setMessage} onRestored={onRestored} compact />
  </section>;
}

function BackupRestorePanel({ busy, setBusy, setMessage, onRestored, compact = false }: {
  busy: boolean;
  setBusy: (value: boolean) => void;
  setMessage: (value: string | null) => void;
  onRestored: (projectId: string) => void | Promise<void>;
  compact?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage(null);
    try { await operation(); } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  return <section className={compact ? "recovery-import compact" : "brief-section recovery-import"}>
    {!compact && <><h2>Restore drill</h2><p>Select a <code>.cyoa-backup.zip</code>. The server performs hostile parsing and isolated reconstruction during preview, then repeats verification on the authoritative bytes during restore.</p></>}
    <input aria-label="Project backup file" type="file" accept=".zip,.cyoa-backup.zip" onChange={(event) => {
      setFile(event.target.files?.[0] ?? null); setPreview(null); setConfirmed(false);
    }} />
    <div className="artifact-actions">
      <button disabled={!file || busy} onClick={() => void perform(async () => {
        if (!file) return; setMessage("Validating the backup and reconstructing an isolated preview...");
        setPreview(await previewProjectBackup(file)); setConfirmed(false); setMessage("Backup preview verified without writing project data.");
      })}>Verify &amp; preview</button>
      <button className="primary" disabled={!file || !preview || preview.conflict || !confirmed || busy} onClick={() => void perform(async () => {
        if (!file) return; setMessage("Revalidating authoritative bytes and restoring the project atomically...");
        const result = await restoreProjectBackup(file); await onRestored(result.projectId);
        setMessage(`Restored verified project ${result.projectId} atomically.`);
      })}>Restore as project</button>
    </div>
    {preview && <>
      <dl className="simulation-metadata">
        <div><dt>Project</dt><dd>{preview.projectName} ({preview.record.projectId})</dd></div>
        <div><dt>Verification</dt><dd>Verified by isolated restore</dd></div>
        <div><dt>Fingerprint</dt><dd>{preview.record.portableProjectFingerprint}</dd></div>
        <div><dt>History mode</dt><dd>{preview.manifest.historyMode}</dd></div>
        <div><dt>Conflict</dt><dd>{preview.conflict ? "Existing stable ID — restore blocked" : "None"}</dd></div>
        <div><dt>Scope</dt><dd>{Object.values(preview.manifest.counts).reduce((sum, count) => sum + count, 0).toLocaleString()} declared rows</dd></div>
      </dl>
      <details><summary>Declared exclusions</summary><ul>{preview.manifest.exclusions.map((item) => <li key={item}>{item}</li>)}</ul></details>
      <p><small>Browser-local native-player saves, credentials, environment settings, raw reasoning, temporary files, and SQLite WAL/journal files are not part of this project backup.</small></p>
      <label className="checkbox"><input type="checkbox" checked={confirmed} disabled={preview.conflict} onChange={(event) => setConfirmed(event.target.checked)} /> I reviewed the identity, scope, exclusions, and collision state.</label>
    </>}
  </section>;
}

function RecoveryMessage({ message, busy }: { message: string; busy: boolean }) {
  const success = busy || /verified|passed|restored|preview/i.test(message);
  if (success) return <p role="status" className="status good">{message}</p>;
  const lower = message.toLowerCase();
  const next = lower.includes("future") || lower.includes("incompatible")
    ? "Keep the original file and open it with a compatible app version. Do not overwrite it."
    : lower.includes("storage") || lower.includes("quota") || lower.includes("disk")
      ? "Free storage or choose writable storage, then retry."
      : lower.includes("database") || lower.includes("migration") || lower.includes("corrupt")
        ? "Stop editing this database; preserve it and restore a verified backup into a separate project."
        : "Check the selected file or storage, then retry the same bounded action.";
  return <div role="alert" className="recovery-message error"><strong>The recovery action did not complete.</strong>
    <p>{message}</p><p>No project was overwritten and the original data remains unchanged. {next}</p></div>;
}

function freshnessText(status: RecoveryStatus): string {
  switch (status.freshness) {
    case "current": return "The latest verified backup matches the current semantic project and application/schema identity.";
    case "changes-since-backup": return "The project has meaningful changes since its latest verified backup.";
    case "schema-upgrade-since-backup": return "The project meaning matches, but the application or database schema changed since backup verification.";
    case "backup-verification-failed": return "The latest backup attempt for this project version failed verification and is not protection.";
    case "never-backed-up": return "No verified backup is recorded for this project.";
    default: return "Current backup protection could not be determined.";
  }
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}
