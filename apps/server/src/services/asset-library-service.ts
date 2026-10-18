import { constants, closeSync, fstatSync, openSync, opendirSync, readSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { IMAGE_ASSET_LIMITS, ImageAssetMetadataSchema, ImageDigestSchema, sourceCanonicalJson, sourceDigest } from "@story-to-cyoa/domain";
import { ConversationRepository, ImageAssetRepository, ProjectRepository, imageSha256, transaction, type StoryDatabase } from "@story-to-cyoa/persistence";
import { prepareImageAsset } from "./image-asset-preparation.js";

const project = { projectId: z.string().uuid() }, asset = { ...project, assetId: z.string().uuid() };
const operation = { ...project, operationId: z.string().uuid(), approved: z.literal(true) };
const exact = { ...asset, versionId: z.string().min(1).max(240) };
const filename = z.string().max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/i);
export const AssetCandidateInput = z.object({ ...operation, assetId: z.string().uuid().optional(), expectedVersionId: z.string().min(1).max(240).optional(), metadata: ImageAssetMetadataSchema }).strict();
export const ConnectedAssetInputs = {
  list_assets: z.object({ ...project, search: z.string().max(200).default(""), offset: z.number().int().min(0).max(200).default(0) }).strict(),
  read_asset: z.object({ ...asset, versionId: z.string().min(1).max(240).optional(), offset: z.number().int().min(0).max(2000).default(0) }).strict(),
  asset_usage: z.object({ ...asset, offset: z.number().int().min(0).max(2000).default(0) }).strict(),
  list_staged_assets: z.object({ ...project, offset: z.number().int().min(0).max(500).default(0) }).strict(),
  import_staged_asset: AssetCandidateInput.extend({ filename, sourceSha256: ImageDigestSchema }).strict(),
  revise_asset: z.object({ ...operation, assetId: z.string().uuid(), expectedVersionId: z.string().min(1).max(240), metadata: ImageAssetMetadataSchema }).strict(),
  review_asset: z.object(exact).strict(),
  approve_asset: z.object({ ...operation, ...exact, fingerprint: ImageDigestSchema }).strict(),
  reject_asset: z.object({ ...operation, ...exact, fingerprint: ImageDigestSchema }).strict(),
};
export type ConnectedAssetTool = keyof typeof ConnectedAssetInputs;
type Outcome = { assetId: string; versionId: string; status: string; providerCalls: 0 };
export class AssetLibraryService {
  private readonly repository: ImageAssetRepository;
  private readonly root?: string;
  private preparing = 0;
  constructor(private readonly database: StoryDatabase, stagingDirectory?: string) {
    this.repository = new ImageAssetRepository(database);
    if (stagingDirectory) { this.root = realpathSync(stagingDirectory); if (!statSync(this.root).isDirectory()) throw new Error("asset_staging_directory_invalid"); }
  }
  private access(projectId: string) {
    const project = new ProjectRepository(this.database).get(projectId);
    if (!project || project.archived || project.mode !== "long-form") throw new Error("image_project_unavailable");
  }
  private async prepare(bytes: Buffer, name: string, kind: "user-upload" | "assistant-import", mime?: string) {
    if (this.preparing >= 2) throw new Error("image_processing_busy_retry: two images are being decoded; retry this same operation");
    this.preparing++;
    try { return await prepareImageAsset(bytes, name, kind, mime); }
    finally { this.preparing--; }
  }
  private present(projectId: string, version: ReturnType<ImageAssetRepository["version"]>) {
    const content = version.content;
    const url = (hash: string) => `/api/long-form/projects/${encodeURIComponent(projectId)}/assets/files/${hash}`;
    const image = this.repository.fileInfo(projectId, content.fileSha256), thumbnail = this.repository.fileInfo(projectId, content.thumbnailSha256);
    return { ...version, image: { sha256: image.sha256, width: image.width, height: image.height, bytes: image.bytes, url: url(image.sha256) },
      thumbnail: { sha256: thumbnail.sha256, width: thumbnail.width, height: thumbnail.height, bytes: thumbnail.bytes, url: url(thumbnail.sha256) } };
  }
  read(projectId: string, assetId: string, versionId?: string, offset = 0) {
    this.access(projectId); const history = this.repository.history(projectId, assetId), selected = versionId ? history.find((v) => v.id === versionId) : history[0];
    if (!selected) throw new Error("image_asset_not_found");
    const approved = history.find((v) => v.content.status === "approved");
    return { assetId, currentVersionId: history[0]!.id, selected: this.present(projectId, selected), approved: approved ? this.present(projectId, approved) : null,
      totalVersions: history.length, offset, history: history.slice(offset, offset + 20).map(({ id, version, createdAt, content }) => ({ id, version, createdAt, status: content.status, title: content.metadata.title, fileSha256: content.fileSha256 })) };
  }
  usage(projectId: string, assetId: string, offset = 0) {
    this.access(projectId); if (!this.repository.head(projectId, assetId)) throw new Error("image_asset_not_found");
    // V1 has library versions, not scene assignments. Do not invent or infer consumers from prose.
    const history = this.repository.history(projectId, assetId);
    return { assetId, assignments: [], totalAssignments: 0, totalLibraryVersions: history.length, offset, libraryVersions: history.slice(offset, offset + 25).map(({ id, content }) => ({ versionId: id, fileSha256: content.fileSha256, thumbnailSha256: content.thumbnailSha256, status: content.status })) };
  }
  review(projectId: string, assetId: string, versionId: string) {
    const detail = this.read(projectId, assetId, versionId);
    if (detail.currentVersionId !== versionId || detail.selected.content.status !== "candidate") throw new Error("image_current_candidate_required_reload_and_review");
    const findings = detail.selected.content.metadata.license ? [] : [{ code: "image_license_unspecified", severity: "warning", message: "License is unspecified." }];
    const usage = this.usage(projectId, assetId);
    return { ...detail, findings, usage, fingerprint: sourceDigest({ versionId, content: detail.selected.content, currentVersionId: detail.currentVersionId, approvedVersionId: detail.approved?.id ?? null, findings, usage }) };
  }
  file(projectId: string, hash: string) { this.access(projectId); return this.repository.file(projectId, ImageDigestSchema.parse(hash)); }
  private replay(projectId: string, operationId: string, tool: string, input: unknown): Outcome | undefined {
    const rows = this.database.prepare(`SELECT m.metadata_json FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE c.project_id=? AND (json_extract(m.metadata_json,'$.assetOperation.operationId')=? OR json_extract(m.metadata_json,'$.connectedOperation.operationId')=?)`).all(projectId, operationId, operationId) as { metadata_json: string }[];
    if (rows.length > 1) throw new Error("image_operation_receipt_ambiguous");
    if (!rows.length) return;
    const saved = JSON.parse(rows[0]!.metadata_json).assetOperation;
    if (!saved) throw new Error("image_operation_id_conflict");
    if (saved.tool !== tool || saved.fingerprint !== sourceDigest({ tool, input })) throw new Error("image_operation_id_conflict");
    const result = saved.result as Outcome, version = this.repository.version(projectId, result.versionId);
    const expectedStatus = tool === "approve_asset" ? "approved" : tool === "reject_asset" ? "rejected" : "candidate";
    if (version.content.assetId !== result.assetId || version.content.status !== result.status || result.status !== expectedStatus || result.providerCalls !== 0
      || tool === "upload_asset" && version.content.provenance.kind !== "user-upload" || tool === "import_staged_asset" && version.content.provenance.kind !== "assistant-import") throw new Error("image_operation_receipt_invalid");
    const i = input as { assetId?: string; expectedVersionId?: string; versionId?: string; metadata?: unknown; sourceSha256?: string };
    if (i.assetId && result.assetId !== i.assetId || i.expectedVersionId && version.content.baseVersionId !== i.expectedVersionId
      || i.versionId && version.content.reviewedCandidateVersionId !== i.versionId || i.metadata && sourceCanonicalJson(version.content.metadata) !== sourceCanonicalJson(i.metadata)
      || i.sourceSha256 && version.content.provenance.sourceSha256 !== i.sourceSha256) throw new Error("image_operation_receipt_invalid");
    return result;
  }
  private once(projectId: string, operationId: string, tool: string, input: unknown, run: () => ReturnType<ImageAssetRepository["version"]>): Outcome {
    return transaction(this.database, () => {
      this.access(projectId); const replay = this.replay(projectId, operationId, tool, input); if (replay) return replay;
      const version = run(), result: Outcome = { assetId: version.content.assetId, versionId: version.id, status: version.content.status, providerCalls: 0 };
      const conversations = new ConversationRepository(this.database), scope = { kind: "project" as const, projectId };
      const conversation = conversations.list(projectId).find((v) => v.title === "Asset library operations") ?? conversations.create(projectId, scope, "Asset library operations");
      conversations.addMessage({ conversationId: conversation.id, role: "assistant", intent: "discuss", scope, content: `${tool} completed`, context: {}, metadata: {
        assetOperation: { operationId, tool, fingerprint: sourceDigest({ tool, input }), result },
      } });
      return result;
    });
  }
  async upload(value: unknown, bytes: Buffer, sourceName: string, mimeType: string) {
    const input = AssetCandidateInput.parse(value), binding = { ...input, sourceSha256: imageSha256(bytes), sourceName, mimeType }; this.access(input.projectId);
    const replay = this.replay(input.projectId, input.operationId, "upload_asset", binding); if (replay) return replay;
    const prepared = await this.prepare(bytes, sourceName, "user-upload", mimeType);
    return this.once(input.projectId, input.operationId, "upload_asset", binding, () => this.repository.candidateInTransaction(input.projectId, input, prepared));
  }
  private stagedBytes(name: string): Buffer {
    if (!this.root) throw new Error("image_staging_disabled"); filename.parse(name);
    let descriptor: number | undefined;
    try {
      descriptor = openSync(join(this.root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = fstatSync(descriptor);
      if (!before.isFile() || !before.size || before.size > IMAGE_ASSET_LIMITS.inputBytes) throw new Error("image_staged_file_invalid_or_too_large");
      const buffer = Buffer.alloc(before.size + 1); let count = 0, read = 0;
      while (count < buffer.length && (read = readSync(descriptor, buffer, count, buffer.length - count, null)) > 0) count += read;
      if (count !== before.size || fstatSync(descriptor).size !== before.size) throw new Error("image_staged_file_changed_retry");
      return buffer.subarray(0, count);
    } catch (error) { throw new Error((error as Error).message.startsWith("image_") ? (error as Error).message : "image_staged_file_unavailable: regular non-symlink files only"); }
    finally { if (descriptor !== undefined) closeSync(descriptor); }
  }
  async call(tool: ConnectedAssetTool, value: unknown): Promise<unknown> {
    const parsed = ConnectedAssetInputs[tool].parse(value); this.access(parsed.projectId);
    switch (tool) {
      case "list_assets": {
        const i = ConnectedAssetInputs.list_assets.parse(value), list = this.repository.list(i.projectId, i.search, i.offset);
        return { ...list, items: list.items.map((v) => ({ assetId: v.content.assetId, versionId: v.id, status: v.content.status, metadata: { title: v.content.metadata.title },
          thumbnailUrl: `/api/long-form/projects/${i.projectId}/assets/files/${v.content.thumbnailSha256}`, approvedVersionId: this.repository.approved(i.projectId, v.content.assetId)?.id ?? null })) };
      }
      case "read_asset": { const i = ConnectedAssetInputs.read_asset.parse(value); return this.read(i.projectId, i.assetId, i.versionId, i.offset); }
      case "asset_usage": { const i = ConnectedAssetInputs.asset_usage.parse(value); return this.usage(i.projectId, i.assetId, i.offset); }
      case "review_asset": { const i = ConnectedAssetInputs.review_asset.parse(value); return this.review(i.projectId, i.assetId, i.versionId); }
      case "list_staged_assets": {
        const i = ConnectedAssetInputs.list_staged_assets.parse(value); if (!this.root) return { enabled: false, total: 0, offset: i.offset, items: [] };
        const directory = opendirSync(this.root), names: string[] = []; let inspected = 0;
        try { for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
          if (++inspected > 2000) throw new Error("image_staging_catalogue_too_large_narrow_directory");
          if (entry.isFile() && filename.safeParse(entry.name).success) names.push(entry.name);
        } } finally { directory.closeSync(); }
        if (names.length > 500) throw new Error("image_staging_catalogue_too_large_narrow_directory");
        names.sort(); return { enabled: true, total: names.length, offset: i.offset, items: names.slice(i.offset, i.offset + 25).map((name) => {
          try { const bytes = this.stagedBytes(name); return { filename: name, sourceSha256: imageSha256(bytes), bytes: bytes.length, available: true }; }
          catch { return { filename: name, available: false }; }
        }) };
      }
      case "import_staged_asset": {
        const i = ConnectedAssetInputs.import_staged_asset.parse(value), replay = this.replay(i.projectId, i.operationId, tool, i); if (replay) return replay;
        const bytes = this.stagedBytes(i.filename); if (imageSha256(bytes) !== i.sourceSha256) throw new Error("image_staged_digest_changed_relist_and_review");
        const prepared = await this.prepare(bytes, i.filename, "assistant-import");
        return this.once(i.projectId, i.operationId, tool, i, () => this.repository.candidateInTransaction(i.projectId, i, prepared));
      }
      case "revise_asset": {
        const i = ConnectedAssetInputs.revise_asset.parse(value);
        return this.once(i.projectId, i.operationId, tool, i, () => this.repository.reviseInTransaction(i.projectId, i.assetId, i.expectedVersionId, i.metadata));
      }
      case "approve_asset": case "reject_asset": {
        const i = ConnectedAssetInputs[tool].parse(value);
        return this.once(i.projectId, i.operationId, tool, i, () => {
          if (this.review(i.projectId, i.assetId, i.versionId).fingerprint !== i.fingerprint) throw new Error("image_review_stale_reload_and_review");
          return this.repository.reviewInTransaction(i.projectId, i.assetId, i.versionId, tool === "approve_asset" ? "approved" : "rejected");
        });
      }
    }
  }
}
