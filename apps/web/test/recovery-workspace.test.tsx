// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalRestorePanel, RecoveryWorkspace } from "../src/features/workspace/RecoveryWorkspace.js";

const fingerprint = "a".repeat(32);
const status = {
  projectId: "project-recovery", currentProjectFingerprint: fingerprint,
  currentSchemaVersion: 17, supportedSchemaVersion: 17, freshness: "never-backed-up",
  latestVerifiedBackup: null,
  reminder: { visible: true, dismissedForCurrentVersion: false, snoozedUntil: null },
  lastVerificationFailure: null, backups: [], restores: [],
};
const record = {
  schemaId: "cyoa.project-backup-record", schemaVersion: 1, backupId: "11111111-1111-4111-8111-111111111111",
  projectId: "project-recovery", gameId: "project-recovery", portableSchemaId: "cyoa.portable-project", portableSchemaVersion: 1,
  portableProjectFingerprint: fingerprint, portableArchiveSha256: "b".repeat(64), portableArchiveByteCount: 1024,
  sourceSqliteSchemaVersion: 17, applicationVersion: "0.1.0", createdAt: "2026-08-30T00:00:00.000Z",
  verificationStatus: "verified", verifiedAt: "2026-08-30T00:00:01.000Z", verificationMethod: "isolated-portable-restore",
  verificationMethodVersion: 1, restoredSemanticFingerprint: fingerprint, verificationDiagnostics: [], sourceChangeFingerprint: fingerprint,
};
const preview = {
  record, projectName: "Recovery tale", conflict: false,
  manifest: { projectId: record.projectId, projectFingerprint: fingerprint, historyMode: "immutable-authoring-history-v1", counts: { projects: 1, passage_entity_versions: 300 }, exclusions: ["credentials", "browser saves"] },
  verification: { verified: true, method: "isolated-portable-restore", diagnostics: ["passed"] },
};
const response = (body: unknown, statusCode = 200, headers: Record<string, string> = {}) => new Response(
  typeof body === "string" ? body : JSON.stringify(body), { status: statusCode, headers: { "content-type": "application/json", ...headers } },
);

Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:backup") });
Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Foundation 8A recovery workspace", () => {
  it("shows factual backup state and accurately describes browser download uncertainty", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const url = String(request);
      if (url === "/api/projects/project-recovery/recovery" && !init?.method) return response(status);
      if (url.endsWith("/recovery/backups") && init?.method === "POST") return response("backup-bytes", 200, {
        "content-type": "application/zip", "content-disposition": "attachment; filename=\"recovery.cyoa-backup.zip\"",
        "x-cyoa-backup-id": record.backupId, "x-cyoa-artifact-fingerprint": fingerprint,
      });
      return response({ error: `Unexpected ${url}` }, 500);
    });
    const user = userEvent.setup();
    render(<RecoveryWorkspace projectId="project-recovery" onProjectDeleted={() => undefined} onProjectRestored={() => undefined} />);
    expect((await screen.findAllByText("No verified backup is recorded for this project.")).length).toBeGreaterThan(0);
    expect(screen.getByText(/does not prove the browser kept/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create, verify & download backup" }));
    expect(await screen.findByText(/was verified and its browser download was initiated/)).toBeTruthy();
    expect(screen.queryByText(/browser retained it$/)).toBeNull();
  });

  it("previews identity, scope, exclusions, and requires explicit confirmation before restore", async () => {
    const restored = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const url = String(request);
      if (url.endsWith("/preview") && init?.method === "POST") return response(preview);
      if (url.endsWith("/restore") && init?.method === "POST") return response({ projectId: record.projectId, backupId: record.backupId, restore: { restoreId: "restore-1" } }, 201);
      return response({ error: `Unexpected ${url}` }, 500);
    });
    const user = userEvent.setup(); render(<GlobalRestorePanel onRestored={restored} />);
    await user.upload(screen.getByLabelText("Project backup file"), new File(["zip"], "project.cyoa-backup.zip", { type: "application/zip" }));
    await user.click(screen.getByRole("button", { name: "Verify & preview" }));
    expect(await screen.findByText(/Recovery tale/)).toBeTruthy();
    expect(screen.getByText("301 declared rows")).toBeTruthy();
    await user.click(screen.getByText("Declared exclusions"));
    expect(screen.getByText("credentials")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Restore as project" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByLabelText(/I reviewed the identity/));
    await user.click(screen.getByRole("button", { name: "Restore as project" }));
    await waitFor(() => expect(restored).toHaveBeenCalledWith("project-recovery"));
  });

  it("surfaces current verified-backup state before deletion and sends exact current identity only after typed confirmation", async () => {
    const deleted = vi.fn(); const requests: Array<{ url: string; body?: string }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const url = String(request); requests.push({ url, body: init?.body ? String(init.body) : undefined });
      if (url === "/api/projects/project-recovery/recovery" && !init?.method) return response({ ...status, freshness: "current", latestVerifiedBackup: record, backups: [record] });
      if (url.endsWith("/permanent-delete") && init?.method === "POST") return new Response(null, { status: 204 });
      return response({ error: `Unexpected ${url}` }, 500);
    });
    const user = userEvent.setup(); render(<RecoveryWorkspace projectId="project-recovery" onProjectDeleted={deleted} onProjectRestored={() => undefined} />);
    expect((await screen.findAllByText(/latest verified backup matches/)).length).toBeGreaterThan(0);
    const opener = screen.getByRole("button", { name: "Review permanent deletion" });
    await user.click(opener);
    const confirmation = screen.getByLabelText("Permanent deletion confirmation");
    await waitFor(() => expect(document.activeElement).toBe(confirmation));
    await user.click(screen.getByRole("button", { name: "Cancel deletion" }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
    await user.click(opener);
    const button = screen.getByRole("button", { name: "Permanently delete project" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Permanent deletion confirmation"), "project-recovery");
    await user.click(button);
    await waitFor(() => expect(deleted).toHaveBeenCalled());
    expect(requests.find((item) => item.url.endsWith("/permanent-delete"))?.body).toContain(fingerprint);
  });

  it("turns incompatible import failures into non-overwriting recovery guidance", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const url = String(request);
      if (url.endsWith("/preview") && init?.method === "POST") return response({ error: "Incompatible future backup schema" }, 400);
      return response({ error: `Unexpected ${url}` }, 500);
    });
    const user = userEvent.setup(); render(<GlobalRestorePanel onRestored={() => undefined} />);
    await user.upload(screen.getByLabelText("Project backup file"), new File(["zip"], "future.cyoa-backup.zip", { type: "application/zip" }));
    await user.click(screen.getByRole("button", { name: "Verify & preview" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("original data remains unchanged");
    expect(alert.textContent).toContain("compatible app version");
    expect((screen.getByRole("button", { name: "Restore as project" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
