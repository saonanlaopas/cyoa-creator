import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import { stableFingerprint } from "@story-to-cyoa/runtime";
import { buildApp } from "../src/app.js";
import { resolveBackupUploadLimit } from "../src/routes/recovery.js";
import { PROJECT_BACKUP_LIMITS } from "../src/services/recovery-service.js";

const apps: Array<ReturnType<typeof buildApp>> = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe("Foundation 8A recovery HTTP boundary", () => {
  it("pins the exact upload ceiling and exposes database compatibility separately from explicit integrity work", async () => {
    expect(resolveBackupUploadLimit()).toBe(PROJECT_BACKUP_LIMITS.archiveBytes);
    expect(resolveBackupUploadLimit(PROJECT_BACKUP_LIMITS.archiveBytes + 1)).toBe(PROJECT_BACKUP_LIMITS.archiveBytes);
    const app = buildApp(); apps.push(app);
    const compatibility = await app.inject({ method: "GET", url: "/api/recovery/database" });
    expect(compatibility.json()).toMatchObject({ compatible: true, integrityStatus: "not-run" });
    const checked = await app.inject({ method: "POST", url: "/api/recovery/database/integrity" });
    expect(checked.json()).toMatchObject({ integrity: { ok: true, method: "quick_check", results: ["ok"] } });
  });

  it("downloads a verified backup, previews without writes, rejects collision, and restores after explicit deletion", async () => {
    const app = buildApp(); apps.push(app);
    const created = await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Recovery route" } });
    const createdProject = created.json();
    const projectId = createdProject.project.id as string;
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`,
      payload: { versionId: createdProject.brief.id },
    });
    const initialBible = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible`, payload: {},
    })).json().bible;
    const savedBibleResponse = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/bible`, payload: {
        ...initialBible.content,
        characters: [...initialBible.content.characters,
          { id: "character-author", name: "Mara", role: "Protagonist", summary: "", motivations: [], knowledge: [], plannedArc: "" },
          { id: "character-partner", name: "Ivo", role: "Partner", summary: "", motivations: [], knowledge: [], plannedArc: "" },
        ],
        relationships: [{
          id: "relationship-backup", characterIds: ["character-author", "character-partner"],
          label: "Mara and Ivo", currentState: "Cautious allies", plannedArc: "Trust",
        }],
      },
    });
    expect(savedBibleResponse.statusCode, savedBibleResponse.body).toBe(201);
    const savedBible = savedBibleResponse.json().bible;
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: savedBible.id },
    });
    const savedDirection = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/creative-direction`, payload: {
        ...createdProject.creativeDirection.content,
        fieldProvenance: [{ fieldPath: "/tone", reference: {
          kind: "approved-artifact", targetId: "brief", versionId: createdProject.brief.id,
        } }],
        relationshipPresentation: { profiles: [{
          id: "backup-romance-profile", relationshipKind: "romance", relationshipId: "relationship-backup",
          participantIds: ["character-author", "character-partner"], developmentStyle: "gradual",
          emotionalTension: "high", melodrama: "low", sensuality: "subtle", physicalIntimacy: "fade-to-black",
          mechanicsVisibility: "subtle", customGuidance: "Preserve slow trust.", contentBoundaries: ["no coercion"],
        }] },
      },
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`,
      payload: { versionId: savedDirection.creativeDirection.id },
    });
    const initial = await app.inject({ method: "GET", url: `/api/projects/${projectId}/recovery` });
    expect(initial.json()).toMatchObject({ freshness: "never-backed-up", reminder: { visible: true } });

    const backup = await app.inject({ method: "POST", url: `/api/projects/${projectId}/recovery/backups` });
    expect(backup.statusCode).toBe(200);
    expect(backup.headers["content-disposition"]).toContain(".cyoa-backup.zip");
    expect(backup.headers["x-cyoa-backup-verification"]).toBe("verified");
    const legacyBackup = rewriteLegacyA1Backup(backup.rawPayload);
    const upload = multipart(legacyBackup, "recovery-route-boundary");
    const preview = await app.inject({ method: "POST", url: "/api/recovery/backups/preview", headers: upload.headers, payload: upload.payload });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      projectName: "Recovery route", conflict: true, verification: { verified: true },
      manifest: { includedSections: expect.not.arrayContaining(["artifact_version_approvals"]) },
    });
    expect((await app.inject({ method: "GET", url: "/api/projects" })).json()).toHaveLength(1);

    const collision = await app.inject({ method: "POST", url: "/api/recovery/backups/restore", headers: upload.headers, payload: upload.payload });
    expect(collision.statusCode).toBe(409);
    expect(collision.json().code).toBe("portable_project_conflict");

    const status = (await app.inject({ method: "GET", url: `/api/projects/${projectId}/recovery` })).json();
    const staleDelete = await app.inject({ method: "POST", url: `/api/projects/${projectId}/recovery/permanent-delete`, payload: {
      projectId, projectFingerprint: "0".repeat(32),
    } });
    expect(staleDelete.statusCode).toBe(409);
    const deleted = await app.inject({ method: "POST", url: `/api/projects/${projectId}/recovery/permanent-delete`, payload: {
      projectId, projectFingerprint: status.currentProjectFingerprint,
    } });
    expect(deleted.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/projects" })).json()).toHaveLength(0);

    const restored = await app.inject({ method: "POST", url: "/api/recovery/backups/restore", headers: upload.headers, payload: upload.payload });
    expect(restored.statusCode, restored.body).toBe(201);
    expect(restored.json()).toMatchObject({ projectId });
    expect((await app.inject({ method: "GET", url: `/api/projects/${projectId}` })).json().name).toBe("Recovery route");
    const restoredDirection = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}` })).json();
    expect(restoredDirection.creativeDirection.id).toBe(savedDirection.creativeDirection.id);
    expect(restoredDirection.creativeDirection.content.relationshipPresentation.profiles[0])
      .toMatchObject({ id: "backup-romance-profile", relationshipKind: "romance", sensuality: "subtle" });
    expect(restoredDirection.workflow["creative-direction"]).toMatchObject({
      status: "approved", approvedVersionId: savedDirection.creativeDirection.id,
    });
  });

  it("applies one streaming limit to preview and restore and does not mutate on rejected uploads", async () => {
    const app = buildApp({ maxProjectBackupBytes: 1_024 }); apps.push(app);
    for (const endpoint of ["preview", "restore"]) {
      const within = multipart(Buffer.alloc(1_024, 0x61), `within-${endpoint}`);
      const parsed = await app.inject({ method: "POST", url: `/api/recovery/backups/${endpoint}`, headers: within.headers, payload: within.payload });
      expect(parsed.statusCode).toBe(400);
      expect(parsed.json().code).not.toBe("backup_upload_too_large");
      const over = multipart(Buffer.alloc(1_025, 0x61), `over-${endpoint}`);
      const rejected = await app.inject({ method: "POST", url: `/api/recovery/backups/${endpoint}`, headers: over.headers, payload: over.payload });
      expect(rejected.statusCode).toBe(413);
      expect(rejected.json().code).toBe("backup_upload_too_large");
    }
    expect((await app.inject({ method: "GET", url: "/api/projects" })).json()).toEqual([]);
  });
});

function multipart(bytes: Buffer, boundary: string) {
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="project.cyoa-backup.zip"\r\nContent-Type: application/zip\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

function rewriteLegacyA1Backup(bytes: Uint8Array): Uint8Array {
  const backupFiles = unzipSync(bytes);
  const portableFiles = unzipSync(backupFiles["portable-project.cyoa.zip"]!);
  const manifest = JSON.parse(new TextDecoder().decode(portableFiles["manifest.json"]!));
  const payload = JSON.parse(new TextDecoder().decode(portableFiles["project.json"]!));
  delete payload.tables.artifact_version_approvals;
  manifest.includedSections = manifest.includedSections.filter((section: string) => section !== "artifact_version_approvals");
  delete manifest.counts.artifact_version_approvals;
  const rows = { projectId: payload.projectId, tables: payload.tables };
  const fingerprint = stableFingerprint({
    schemaId: "cyoa.portable-project", schemaVersion: 1,
    historyMode: "immutable-authoring-history-v1", rows,
  });
  payload.projectFingerprint = fingerprint;
  manifest.projectFingerprint = fingerprint;
  manifest.counts = Object.fromEntries(manifest.includedSections.map((section: string) => [section, payload.tables[section].length]));
  const payloadBytes = strToU8(canonicalJson(payload));
  manifest.files = [{ path: "project.json", bytes: payloadBytes.byteLength, sha256: sha256(payloadBytes) }];
  const fixedDate = new Date(1980, 0, 1, 0, 0, 0, 0);
  const portableBytes = zipSync({
    "manifest.json": [strToU8(canonicalJson(manifest)), { mtime: fixedDate }],
    "project.json": [payloadBytes, { mtime: fixedDate }],
  }, { level: 9 });

  const record = JSON.parse(new TextDecoder().decode(backupFiles["backup-record.json"]!));
  record.portableProjectFingerprint = fingerprint;
  record.sourceChangeFingerprint = fingerprint;
  record.restoredSemanticFingerprint = fingerprint;
  record.portableArchiveSha256 = sha256(portableBytes);
  record.portableArchiveByteCount = portableBytes.byteLength;
  return zipSync({
    "backup-record.json": [strToU8(canonicalJson(record)), { mtime: fixedDate, level: 9 }],
    "portable-project.cyoa.zip": [portableBytes, { mtime: fixedDate, level: 0 }],
  });
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
