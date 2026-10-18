import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { IMAGE_ASSET_LIMITS, type ImageAsset, type ImageAssetMetadata } from "@story-to-cyoa/domain";
import { ArtifactRepository, ImageAssetRepository, PortableProjectRepository, ProjectRepository, encodeAssetPng, imageSha256, openDatabase, transaction, validateImageAssets } from "@story-to-cyoa/persistence";
import { AssetLibraryService } from "../src/services/asset-library-service.js";
import { boundedConnectedResult, CONNECTED_RESULT_BYTES } from "../src/services/connected-edit-service.js";
import { prepareImageAsset } from "../src/services/image-asset-preparation.js";
import { PublicationExportService } from "../src/services/publication-export-service.js";
import { validatePortableAuthoringProject } from "../src/services/portable-project-validator.js";
import { prepareStudioHistoryDuplicate } from "../src/services/studio-history-duplication.js";
import { buildApp } from "../src/app.js";
import { RecoveryService } from "../src/services/recovery-service.js";
import { fixtureImage, imageMetadata } from "../../../e2e/helpers/image-assets.js";
import { completeConnectedTextGame } from "../../../e2e/helpers/connected-text-game.js";

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cyoa-assets-")), db = openDatabase(), projects = new ProjectRepository(db), project = projects.create("Asset project", randomUUID(), "long-form");
  const service = new AssetLibraryService(db, root), repository = new ImageAssetRepository(db), artifacts = new ArtifactRepository(db);
  cleanup.push(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  const upload = (metadata = imageMetadata, extra: Record<string, unknown> = {}, bytes = fixtureImage()) => service.upload({ projectId: project.id, operationId: randomUUID(), approved: true, metadata, ...extra }, bytes, "harbor.png", "image/png");
  const review = async (outcome: { assetId: string; versionId: string }, tool: "approve_asset" | "reject_asset" = "approve_asset") => {
    const result = service.review(project.id, outcome.assetId, outcome.versionId);
    const input = { projectId: project.id, operationId: randomUUID(), approved: true, assetId: outcome.assetId, versionId: outcome.versionId, fingerprint: result.fingerprint };
    return { result: await service.call(tool, input) as any, input };
  };
  return { root, db, projects, projectId: project.id, service, repository, artifacts, upload, review };
}

describe("V1 image preparation and immutable library", () => {
  it.each(["png", "jpeg", "webp"] as const)("decodes static %s, creates canonical content-addressed PNG and a real bounded thumbnail", async (format) => {
    const input = await sharp(fixtureImage()).toFormat(format).toBuffer(), prepared = await prepareImageAsset(input, "/private/device/harbor.image", "user-upload");
    expect(prepared.image).toMatchObject({ width: 512, height: 320, mimeType: "image/png", sha256: imageSha256(Buffer.from(prepared.image.base64, "base64")) });
    expect(prepared.thumbnail).toMatchObject({ width: 256, height: 160 });
    expect(prepared.provenance).toMatchObject({ sourceName: "harbor.image", sourceMimeType: `image/${format === "jpeg" ? "jpeg" : format}`, providerCalls: 0 });
    expect(prepared.image.base64).not.toBe(prepared.thumbnail.base64);
    expect((await sharp(Buffer.from(prepared.thumbnail.base64, "base64")).raw().toBuffer()).some((v) => v > 0)).toBe(true);
  });
  it("applies orientation and removes source metadata rather than retaining private EXIF", async () => {
    const jpeg = await sharp(fixtureImage(40, 20)).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const prepared = await prepareImageAsset(jpeg, "oriented.jpg", "assistant-import");
    expect(prepared.image).toMatchObject({ width: 20, height: 40 });
    expect((await sharp(Buffer.from(prepared.image.base64, "base64")).metadata()).exif).toBeUndefined();
  });
  it("rejects PNG animation controls instead of silently flattening the first frame", async () => {
    const bytes = fixtureImage(), chunk = Buffer.alloc(20); chunk.writeUInt32BE(8, 0); chunk.write("acTL", 4); chunk.writeUInt32BE(2, 8); chunk.writeUInt32BE(crc32(chunk.subarray(4, 16)), 16);
    const animated = Buffer.concat([bytes.subarray(0, 33), chunk, bytes.subarray(33)]);
    await expect(prepareImageAsset(animated, "animated.png", "user-upload")).rejects.toThrow("animation_unsupported");
  });
  it("rejects a real multi-frame WebP", async () => {
    const bytes = await sharp([fixtureImage(20, 20), fixtureImage(20, 20, true)], { join: { animated: true } }).webp({ loop: 0, delay: 100 }).toBuffer();
    expect((await sharp(bytes).metadata()).pages).toBe(2);
    await expect(prepareImageAsset(bytes, "animated.webp", "user-upload")).rejects.toThrow("static_png_jpeg_webp_required");
  });
  it.each(["SVG", "GIF", "garbage", "truncated", "mime", "dimensions", "size"])("rejects invalid %s before persistence", async (kind) => {
    let bytes = fixtureImage(), mime = "image/png";
    if (kind === "SVG") bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
    if (kind === "GIF") bytes = Buffer.from("GIF89a");
    if (kind === "garbage") bytes = Buffer.from("not an image");
    if (kind === "truncated") bytes = bytes.subarray(0, bytes.length - 30);
    if (kind === "mime") mime = "image/jpeg";
    if (kind === "dimensions") bytes = await sharp({ create: { width: 4097, height: 1, channels: 4, background: "red" } }).png().toBuffer();
    if (kind === "size") bytes = Buffer.alloc(IMAGE_ASSET_LIMITS.inputBytes + 1);
    const f = fixture(); await expect(f.service.upload({ projectId: f.projectId, operationId: randomUUID(), approved: true, metadata: imageMetadata }, bytes, "input.png", mime)).rejects.toThrow();
    expect(f.db.prepare("SELECT COUNT(*) n FROM artifact_versions").get()).toEqual(expect.objectContaining({ n: 0 }));
  });
  it("keeps approved bytes immutable through replacement, rejection and metadata revision, with explicit reapproval", async () => {
    const f = fixture(), first = await f.upload(), approved = (await f.review(first)).result;
    const old = f.service.read(f.projectId, first.assetId).approved!;
    const replacement = await f.upload({ ...imageMetadata, title: "Sunset harbor" }, { assetId: first.assetId, expectedVersionId: approved.versionId }, fixtureImage(512, 320, true));
    expect(f.service.read(f.projectId, first.assetId)).toMatchObject({ selected: { id: replacement.versionId, content: { status: "candidate" } }, approved: { id: old.id } });
    const rejected = (await f.review(replacement, "reject_asset")).result;
    const revised = await f.service.call("revise_asset", { projectId: f.projectId, operationId: randomUUID(), approved: true, assetId: first.assetId, expectedVersionId: rejected.versionId, metadata: { ...imageMetadata, title: "Revised sunset" } }) as any;
    const final = (await f.review(revised)).result;
    expect(f.service.read(f.projectId, first.assetId).approved?.id).toBe(final.versionId);
    expect(f.service.read(f.projectId, first.assetId, old.id).selected.image.sha256).toBe(old.image.sha256);
    expect(f.service.usage(f.projectId, first.assetId)).toMatchObject({ totalAssignments: 0, totalLibraryVersions: 6 });
    validateImageAssets(f.db, f.projectId);
  });
  it("deduplicates exact files without merging distinct asset identities", async () => {
    const f = fixture(), a = await f.upload(), b = await f.upload(); expect(a.assetId).not.toBe(b.assetId);
    expect(f.db.prepare("SELECT COUNT(*) n FROM artifact_versions WHERE artifact_type='image-file'").get()).toEqual(expect.objectContaining({ n: 2 }));
  });
  it("retries concurrent identical uploads once and rejects changed arguments without extra files or versions", async () => {
    const f = fixture(), input = { projectId: f.projectId, operationId: randomUUID(), approved: true, metadata: imageMetadata }, bytes = fixtureImage();
    const a = f.service.upload(input, bytes, "harbor.png", "image/png"), b = f.service.upload(input, bytes, "harbor.png", "image/png");
    expect(await a).toEqual(await b); expect(f.repository.list(f.projectId).total).toBe(1);
    await expect(f.service.upload({ ...input, metadata: { ...imageMetadata, title: "Changed" } }, bytes, "harbor.png", "image/png")).rejects.toThrow("id_conflict");
    await expect(f.service.upload(input, bytes, "different.png", "image/png")).rejects.toThrow("id_conflict");
  });
  it("rolls back files, candidate and success receipt together, then permits the exact retry", async () => {
    const f = fixture(), input = { projectId: f.projectId, operationId: randomUUID(), approved: true, metadata: imageMetadata };
    f.db.exec("CREATE TEMP TRIGGER fail_assets BEFORE INSERT ON messages WHEN json_type(NEW.metadata_json,'$.assetOperation') IS NOT NULL BEGIN SELECT RAISE(ABORT,'asset receipt failed'); END");
    await expect(f.service.upload(input, fixtureImage(), "harbor.png", "image/png")).rejects.toThrow("asset receipt failed");
    expect(f.db.prepare("SELECT COUNT(*) n FROM artifact_versions").get()).toEqual(expect.objectContaining({ n: 0 }));
    f.db.exec("DROP TRIGGER fail_assets"); expect(await f.service.upload(input, fixtureImage(), "harbor.png", "image/png")).toMatchObject({ status: "candidate" });
  });
  it.each(["revise_asset", "approve_asset", "reject_asset"] as const)("rolls back %s and its receipt, retaining an exact retry", async (tool) => {
    const f = fixture(), candidate = await f.upload(), review = f.service.review(f.projectId, candidate.assetId, candidate.versionId);
    const input = { projectId: f.projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId,
      ...(tool === "revise_asset" ? { expectedVersionId: candidate.versionId, metadata: { ...imageMetadata, title: "Revised metadata" } } : { versionId: candidate.versionId, fingerprint: review.fingerprint }) };
    f.db.exec("CREATE TEMP TRIGGER fail_assets BEFORE INSERT ON messages WHEN json_type(NEW.metadata_json,'$.assetOperation') IS NOT NULL BEGIN SELECT RAISE(ABORT,'asset receipt failed'); END");
    await expect(f.service.call(tool, input)).rejects.toThrow("asset receipt failed"); expect(f.repository.head(f.projectId, candidate.assetId)?.id).toBe(candidate.versionId);
    expect(f.repository.approved(f.projectId, candidate.assetId)).toBeNull();
    f.db.exec("DROP TRIGGER fail_assets"); expect(await f.service.call(tool, input)).toEqual(await f.service.call(tool, input));
  });
  it("bounds simultaneous decodes with a retryable busy result and no partial third candidate", async () => {
    const f = fixture(), input = { projectId: f.projectId, operationId: randomUUID(), approved: true, metadata: imageMetadata }, bytes = fixtureImage();
    const a = f.upload(), b = f.upload();
    await expect(f.service.upload(input, bytes, "third.png", "image/png")).rejects.toThrow("processing_busy_retry");
    await a; await b; expect(f.repository.list(f.projectId).total).toBe(2);
    expect(await f.service.upload(input, bytes, "third.png", "image/png")).toMatchObject({ status: "candidate" });
  });
  it("rejects stale reviews and asynchronous replacement races while preserving current approved work", async () => {
    const f = fixture(), first = await f.upload(), oldReview = f.service.review(f.projectId, first.assetId, first.versionId);
    const input = { projectId: f.projectId, operationId: randomUUID(), approved: true, assetId: first.assetId, expectedVersionId: first.versionId, metadata: { ...imageMetadata, title: "Current author edit" } };
    const pending = f.upload(imageMetadata, { assetId: first.assetId, expectedVersionId: first.versionId }, fixtureImage(80, 80, true));
    const revised = await f.service.call("revise_asset", input) as any;
    await expect(pending).rejects.toThrow("head_stale");
    await expect(f.service.call("approve_asset", { ...input, expectedVersionId: undefined, metadata: undefined, versionId: first.versionId, fingerprint: oldReview.fingerprint })).rejects.toThrow();
    expect(f.service.read(f.projectId, first.assetId).currentVersionId).toBe(revised.versionId);
    expect(f.db.prepare("SELECT COUNT(*) n FROM artifact_versions WHERE artifact_type='image-file'").get()).toEqual(expect.objectContaining({ n: 2 }));
    await f.review(revised);
  });
  it("enforces lifecycle, file immutability and project ownership at direct persistence boundaries", async () => {
    const f = fixture(), first = await f.upload(), candidate = f.repository.version(f.projectId, first.versionId), file = f.repository.file(f.projectId, candidate.content.fileSha256);
    expect(() => f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: `image-file:${file.sha256}`, artifactType: "image-file", content: file })).toThrow("identity_invalid");
    expect(() => f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: candidate.artifactId, artifactType: "image-asset", content: { ...candidate.content, status: "approved" } })).toThrow();
    expect(() => f.artifacts.restore(f.projectId, candidate.artifactId, candidate.id)).toThrow("new_candidate");
    const other = f.projects.create("Other", randomUUID(), "long-form");
    expect(() => f.repository.version(other.id, candidate.id)).toThrow("not_found");
    expect(() => f.artifacts.saveArtifact({ projectId: other.id, artifactId: candidate.artifactId, artifactType: "image-asset", content: candidate.content })).toThrow("file_missing");
  });
  it("bounds metadata pages and asset count without losing an existing approval", async () => {
    const f = fixture(), prepared = await prepareImageAsset(fixtureImage(2, 2), "small.png", "user-upload");
    for (let n = 0; n < IMAGE_ASSET_LIMITS.assets; n++) transaction(f.db, () => f.repository.candidateInTransaction(f.projectId, { metadata: { ...imageMetadata, title: `Study ${n}` } }, prepared));
    expect(f.repository.list(f.projectId).items).toHaveLength(25);
    expect(f.repository.list(f.projectId, "Study 199").total).toBe(1);
    expect(() => transaction(f.db, () => f.repository.candidateInTransaction(f.projectId, { metadata: imageMetadata }, prepared))).toThrow("budget_exceeded");
    expect(f.repository.list(f.projectId).total).toBe(200);
  });
  it("finishes all pending reviews at the authoring cap, restores legacy boundary states and retries completed outcomes", async () => {
    const f = fixture(), prepared = await prepareImageAsset(fixtureImage(1, 1), "small.png", "user-upload");
    const create = () => transaction(f.db, () => f.repository.candidateInTransaction(f.projectId, { metadata: imageMetadata }, prepared));
    let head = create(); const second = create();
    for (let n = 2; n < IMAGE_ASSET_LIMITS.versions - 2; n++) head = transaction(f.db, () => f.repository.reviseInTransaction(f.projectId, head.content.assetId, head.id, imageMetadata));
    const third = create(); // A new asset at 1,999 and a revision at 2,000 both retain completion capacity.
    head = transaction(f.db, () => f.repository.reviseInTransaction(f.projectId, head.content.assetId, head.id, imageMetadata));
    const counts = () => f.db.prepare("SELECT (SELECT COUNT(*) FROM artifact_versions) artifacts,(SELECT COUNT(*) FROM messages) messages").get();
    const before = counts();
    expect(() => create()).toThrow("budget_exceeded");
    expect(() => transaction(f.db, () => f.repository.reviseInTransaction(f.projectId, head.content.assetId, head.id, imageMetadata))).toThrow("budget_exceeded");
    await expect(f.upload(imageMetadata, {}, fixtureImage(2, 2, true))).rejects.toThrow("budget_exceeded");
    await expect(f.service.call("revise_asset", { projectId: f.projectId, operationId: randomUUID(), approved: true, assetId: head.content.assetId, expectedVersionId: head.id, metadata: imageMetadata })).rejects.toThrow("budget_exceeded");
    expect(counts()).toEqual(before); // Failed authoring retains neither new files nor success receipts.

    const legacy = new PortableProjectRepository(f.db).exportStudioRows(f.projectId), recovered = openDatabase(); cleanup.push(() => recovered.close());
    new PortableProjectRepository(recovered).importRows(legacy, validatePortableAuthoringProject);
    const recoveredService = new AssetLibraryService(recovered), recoveredReview = recoveredService.review(f.projectId, head.content.assetId, head.id);
    expect(await recoveredService.call("reject_asset", { projectId: f.projectId, operationId: randomUUID(), approved: true, assetId: head.content.assetId, versionId: head.id, fingerprint: recoveredReview.fingerprint })).toMatchObject({ status: "rejected" });

    const approval = await f.review({ assetId: head.content.assetId, versionId: head.id });
    const rejection = await f.review({ assetId: second.content.assetId, versionId: second.id }, "reject_asset");
    const final = await f.review({ assetId: third.content.assetId, versionId: third.id });
    expect(f.db.prepare("SELECT COUNT(*) n FROM artifact_versions WHERE artifact_type='image-asset'").get()).toEqual(expect.objectContaining({ n: 2003 }));
    expect(() => transaction(f.db, () => f.repository.reviseInTransaction(f.projectId, head.content.assetId, approval.result.versionId, imageMetadata))).toThrow("budget_exceeded");
    validateImageAssets(f.db, f.projectId);

    const portable = new PortableProjectRepository(f.db), publication = new PublicationExportService(portable, undefined);
    const backup = await new RecoveryService(f.db, portable, publication).createVerifiedBackup(f.projectId);
    expect(backup.record.verificationStatus).toBe("verified");
    const restored = openDatabase(); cleanup.push(() => restored.close()); const restoredPortable = new PortableProjectRepository(restored);
    await new RecoveryService(restored, restoredPortable, new PublicationExportService(restoredPortable, undefined)).restoreBackup(backup.bytes);
    const service = new AssetLibraryService(restored);
    expect(await service.call("approve_asset", approval.input)).toEqual(approval.result);
    expect(await service.call("reject_asset", rejection.input)).toEqual(rejection.result);
    expect(await service.call("approve_asset", final.input)).toEqual(final.result);
    expect(new ImageAssetRepository(restored).history(f.projectId, head.content.assetId)).toEqual(f.repository.history(f.projectId, head.content.assetId));

    const forged = portable.exportStudioRows(f.projectId), row = forged.tables.artifact_versions.find((v) => v.id === approval.result.versionId)!;
    const content = JSON.parse(String(row.content_json));
    forged.tables.artifact_versions.push({ ...row, id: randomUUID(), version: Number(row.version) + 1,
      content_json: JSON.stringify({ ...content, status: "candidate", baseVersionId: row.id, reviewedCandidateVersionId: null }) });
    const invalid = openDatabase(); cleanup.push(() => invalid.close());
    expect(() => new PortableProjectRepository(invalid).importRows(forged, validatePortableAuthoringProject)).toThrow("budget_exceeded");
    expect(new ProjectRepository(invalid).get(f.projectId)).toBeUndefined();
  }, 90000);
  it("discovers every identically searchable Unicode asset with compact transport-safe pages and full metadata on read", async () => {
    const f = fixture(), prepared = await prepareImageAsset(fixtureImage(1, 1), "small.png", "user-upload");
    const metadata: ImageAssetMetadata = { title: "海".repeat(200), description: "海".repeat(2000), altText: "海".repeat(1000),
      tags: Array.from({ length: 20 }, () => "海".repeat(60)), credit: "海".repeat(300), license: "海".repeat(300) };
    const expected: string[] = [];
    for (let n = 0; n < 52; n++) expected.push(transaction(f.db, () => f.repository.candidateInTransaction(f.projectId, { metadata }, prepared)).content.assetId);
    const seen: string[] = [];
    for (const search of ["", "海"]) {
      seen.length = 0;
      for (let offset = 0; offset < 52; offset += 25) {
        const page = boundedConnectedResult(await f.service.call("list_assets", { projectId: f.projectId, search, offset })) as any;
        expect(page).toMatchObject({ total: 52, offset }); expect(page.items).toHaveLength(Math.min(25, 52 - offset));
        expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(CONNECTED_RESULT_BYTES);
        if (offset === 0) {
          const formerPage = { ...page, items: page.items.map((v: any) => ({ ...v, metadata })) };
          expect(Buffer.byteLength(JSON.stringify(formerPage))).toBeGreaterThan(CONNECTED_RESULT_BYTES);
        }
        for (const item of page.items) { expect(item.metadata).toEqual({ title: metadata.title }); seen.push(item.assetId); }
      }
      expect(new Set(seen).size).toBe(52); expect([...seen].sort()).toEqual([...expected].sort());
    }
    const detail = boundedConnectedResult(await f.service.call("read_asset", { projectId: f.projectId, assetId: seen[0] })) as any;
    expect(detail.selected.content.metadata).toEqual(metadata);
  });
});

describe("V1 restricted staging and portability", () => {
  it("restricts imports to regular staged images and exact digest, retaining retry after the source disappears", async () => {
    const f = fixture(), bytes = fixtureImage(); writeFileSync(join(f.root, "harbor.png"), bytes);
    symlinkSync(join(f.root, "harbor.png"), join(f.root, "symlink.png"));
    const catalogue = await f.service.call("list_staged_assets", { projectId: f.projectId }) as any; expect(catalogue.items).toHaveLength(1);
    const input = { projectId: f.projectId, operationId: randomUUID(), approved: true, filename: "harbor.png", sourceSha256: imageSha256(bytes), metadata: imageMetadata };
    for (const name of ["../harbor.png", join(f.root, "harbor.png"), "symlink.png"]) await expect(f.service.call("import_staged_asset", { ...input, filename: name })).rejects.toThrow();
    await expect(f.service.call("import_staged_asset", { ...input, sourceSha256: "0".repeat(64) })).rejects.toThrow("digest_changed");
    const imported = await f.service.call("import_staged_asset", input) as any;
    expect(f.service.read(f.projectId, imported.assetId).selected.content.provenance.kind).toBe("assistant-import");
    unlinkSync(join(f.root, "harbor.png")); expect(await f.service.call("import_staged_asset", input)).toEqual(imported);
    await expect(f.service.call("import_staged_asset", { ...input, operationId: randomUUID() })).rejects.toThrow("unavailable");
    expect(await new AssetLibraryService(f.db).call("list_staged_assets", { projectId: f.projectId })).toMatchObject({ enabled: false });
  });
  it.each(["full-fidelity", "privacy-redacted"] as const)("round trips all image bytes, candidate/approved history, and independent duplication: %s", async (mode) => {
    const f = fixture(), first = await f.upload(), approved = (await f.review(first)).result;
    await f.upload({ ...imageMetadata, title: "Pending replacement" }, { assetId: first.assetId, expectedVersionId: approved.versionId }, fixtureImage(80, 50, true));
    const publication = new PublicationExportService(new PortableProjectRepository(f.db), undefined), archive = publication.exportStudioPortable(f.projectId, mode);
    const target = openDatabase(); cleanup.push(() => target.close());
    const portable = new PortableProjectRepository(target), exports = new PublicationExportService(portable, undefined); exports.importPortable(archive.bytes);
    const restored = new AssetLibraryService(target), detail = restored.read(f.projectId, first.assetId);
    expect(detail).toEqual(f.service.read(f.projectId, first.assetId));
    const copy = new ProjectRepository(target).duplicate(f.projectId, "Copied assets", validatePortableAuthoringProject, prepareStudioHistoryDuplicate);
    const copied = restored.read(copy.id, first.assetId); expect(copied.approved?.image.sha256).toBe(detail.approved?.image.sha256);
    expect(copied.selected.id).not.toBe(detail.selected.id);
    new ProjectRepository(target).remove(f.projectId);
    expect(restored.file(copy.id, copied.selected.image.sha256).base64).toBe(f.service.file(f.projectId, detail.selected.image.sha256).base64);
    validatePortableAuthoringProject(target, copy.id); expect(exports.exportStudioPortable(copy.id, mode).bytes.length).toBeGreaterThan(0);
  });
  it.each(["bytes", "dimensions", "thumbnail", "approval"])("rejects forged %s atomically on import", async (kind) => {
    const f = fixture(), first = await f.upload(); await f.review(first);
    const rows = new PortableProjectRepository(f.db).exportStudioRows(f.projectId);
    const files = rows.tables.artifact_versions.filter((r) => r.artifact_type === "image-file"), records = rows.tables.artifact_versions.filter((r) => r.artifact_type === "image-asset");
    if (kind === "bytes") { const content = JSON.parse(String(files[0]!.content_json)); content.base64 = "AAAA"; files[0]!.content_json = JSON.stringify(content); }
    if (kind === "dimensions") { const content = JSON.parse(String(files[0]!.content_json)); content.width = 1; files[0]!.content_json = JSON.stringify(content); }
    if (kind === "thumbnail") { const content = JSON.parse(String(records[0]!.content_json)); content.thumbnailSha256 = "0".repeat(64); records[0]!.content_json = JSON.stringify(content); }
    if (kind === "approval") { const row = records.find((r) => JSON.parse(String(r.content_json)).status === "approved")!, content = JSON.parse(String(row.content_json)) as ImageAsset; content.metadata.title = "Forged reviewed content"; row.content_json = JSON.stringify(content); }
    const target = openDatabase(); cleanup.push(() => target.close());
    expect(() => new PortableProjectRepository(target).importRows(rows, validatePortableAuthoringProject)).toThrow();
    expect(new ProjectRepository(target).get(f.projectId)).toBeUndefined();
  });
  it("creates a verified backup and restores image material, approvals and operation retries into a fresh database", async () => {
    const f = fixture(), candidate = await f.upload(), approval = await f.review(candidate);
    const portable = new PortableProjectRepository(f.db), publication = new PublicationExportService(portable, undefined);
    const backup = await new RecoveryService(f.db, portable, publication).createVerifiedBackup(f.projectId);
    expect(backup.record.verificationStatus).toBe("verified");
    const target = openDatabase(); cleanup.push(() => target.close()); const targetPortable = new PortableProjectRepository(target);
    await new RecoveryService(target, targetPortable, new PublicationExportService(targetPortable, undefined)).restoreBackup(backup.bytes);
    const restored = new AssetLibraryService(target); expect(restored.read(f.projectId, candidate.assetId)).toEqual(f.service.read(f.projectId, candidate.assetId));
    expect(await restored.call("approve_asset", approval.input)).toEqual(approval.result);
  });
  it("uses real SDK transport, denies unauthorized projects, and recovers staged import/approval retries after restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "cyoa-assets-sdk-")), databasePath = join(root, "library.sqlite"), projectId = randomUUID(), token = "asset-test-auth-credential-00000000000000";
    cleanup.push(() => rmSync(root, { recursive: true, force: true })); writeFileSync(join(root, "harbor.png"), fixtureImage());
    const start = async () => {
      const app = buildApp({ databasePath, assetStagingDirectory: root, connectedEditing: { token, projectIds: [projectId], allowProjectCreation: true } });
      const address = await app.listen({ host: "127.0.0.1", port: 0 }); cleanup.push(() => app.close());
      const client = new Client({ name: "v1-no-model-test", version: "1" }); await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })); cleanup.push(() => client.close());
      const call = async (name: string, input: Record<string, unknown>) => { const result = await client.callTool({ name, arguments: input }); if (result.isError) throw new Error(JSON.stringify(result.content)); return result.structuredContent as any; };
      return { app, address, client, call };
    };
    const first = await start(), creationId = randomUUID(); await first.call("create_project", { projectId, operationId: creationId, name: "Native asset project", approved: true });
    const game = await completeConnectedTextGame(first.call, projectId), readinessBefore = await first.call("publication_readiness", { projectId });
    await expect(first.call("list_assets", { projectId: randomUUID() })).rejects.toThrow("access_denied");
    const input = { projectId, operationId: randomUUID(), approved: true, filename: "harbor.png", sourceSha256: imageSha256(fixtureImage()), metadata: imageMetadata };
    await expect(first.call("import_staged_asset", { ...input, operationId: creationId })).rejects.toThrow("id_conflict");
    const candidate = await first.call("import_staged_asset", input), review = await first.call("review_asset", { projectId, ...{ assetId: candidate.assetId, versionId: candidate.versionId } });
    const approval = { projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, versionId: candidate.versionId, fingerprint: review.fingerprint };
    const approved = await first.call("approve_asset", approval), bytes = await fetch(`${first.address}${review.selected.image.url}`); expect(bytes.ok).toBe(true); expect(bytes.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(first.call("create_project", { projectId, operationId: input.operationId, approved: true, name: "Conflict" })).rejects.toThrow("id_conflict");
    expect((await first.call("publication_readiness", { projectId })).sourceInputFingerprint).toBe(readinessBefore.sourceInputFingerprint);
    expect(await first.call("export_game", { projectId, buildVersionId: game.compiled.buildVersionId, format: "standalone" })).toMatchObject({ historical: false });
    const before = Buffer.from(await bytes.arrayBuffer());
    await first.client.close(); await first.app.close(); unlinkSync(join(root, "harbor.png"));
    const second = await start(); expect(await second.call("import_staged_asset", input)).toEqual(candidate); expect(await second.call("approve_asset", approval)).toEqual(approved);
    const detail = await second.call("read_asset", { projectId, assetId: candidate.assetId });
    expect(Buffer.from(await (await fetch(`${second.address}${detail.approved.image.url}`)).arrayBuffer())).toEqual(before);
    for (const headers of [{ origin: "https://untrusted.example" }, { "sec-fetch-site": "cross-site" }, { host: "untrusted.example" }]) {
      const denied = await second.app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/assets`, headers }); expect(denied.statusCode).toBe(403);
    }
  });
});
