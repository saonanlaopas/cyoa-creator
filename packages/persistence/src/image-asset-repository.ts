import { randomUUID } from "node:crypto";
import { ImageAssetMetadataSchema, ImageAssetSchema, type ImageAsset, type ImageAssetMetadata, type ImageFile } from "@story-to-cyoa/domain";
import { ArtifactRepository, type ArtifactVersion } from "./artifact-repository.js";
import { assertImageArtifact, imageAssetKey, imageFileKey, imageFileMetadata, validateImageFile } from "./image-asset-validation.js";
import type { StoryDatabase } from "./database.js";

export class ImageAssetRepository {
  private readonly artifacts: ArtifactRepository;
  constructor(private readonly database: StoryDatabase) { this.artifacts = new ArtifactRepository(database); }
  list(projectId: string, search = "", offset = 0) {
    const where = `project_id=? AND artifact_type='image-asset' AND version=(SELECT MAX(v.version) FROM artifact_versions v WHERE v.project_id=artifact_versions.project_id AND v.artifact_id=artifact_versions.artifact_id)
      AND (?='' OR instr(lower(json_extract(content_json,'$.metadata.title') || ' ' || json_extract(content_json,'$.metadata.description') || ' ' || json_extract(content_json,'$.metadata.tags')),lower(?))>0)`;
    const total = this.database.prepare(`SELECT COUNT(*) total FROM artifact_versions WHERE ${where}`).get(projectId, search, search) as { total: number };
    const rows = this.database.prepare(`SELECT id FROM artifact_versions WHERE ${where} ORDER BY created_at DESC,id LIMIT 25 OFFSET ?`).all(projectId, search, search, offset) as { id: string }[];
    return { total: total.total, offset, items: rows.map(({ id }) => this.version(projectId, id)) };
  }
  version(projectId: string, versionId: string): ArtifactVersion<ImageAsset> {
    const version = this.artifacts.getVersion<ImageAsset>(versionId);
    if (!version || version.projectId !== projectId || version.artifactType !== "image-asset") throw new Error("image_asset_version_not_found");
    assertImageArtifact(this.database, { id: version.id, project_id: projectId, artifact_id: version.artifactId, artifact_type: version.artifactType,
      version: version.version, schema_version: version.schemaVersion, content_json: JSON.stringify(version.content) }, version.content);
    return version;
  }
  history(projectId: string, assetId: string) {
    return this.artifacts.listVersions<ImageAsset>(projectId, imageAssetKey(assetId)).map((v) => this.version(projectId, v.id));
  }
  head(projectId: string, assetId: string) { const version = this.artifacts.getCurrent(projectId, imageAssetKey(assetId)); return version ? this.version(projectId, version.id) : undefined; }
  approved(projectId: string, assetId: string) { return this.history(projectId, assetId).find((v) => v.content.status === "approved") ?? null; }
  file(projectId: string, hash: string) {
    const version = this.artifacts.getCurrent<ImageFile>(projectId, imageFileKey(hash));
    if (!version || version.artifactType !== "image-file" || version.version !== 1) throw new Error("image_file_not_found");
    return validateImageFile(version.content);
  }
  fileInfo(projectId: string, hash: string) { return imageFileMetadata(this.database, projectId, hash); }
  saveFileInTransaction(projectId: string, file: ImageFile) {
    const existing = this.artifacts.getCurrent<ImageFile>(projectId, imageFileKey(file.sha256));
    if (existing) { if (this.file(projectId, file.sha256).base64 !== file.base64) throw new Error("image_file_hash_collision"); return; }
    this.artifacts.saveArtifactInTransaction({ projectId, artifactId: imageFileKey(file.sha256), artifactType: "image-file", content: file, markDependentsStale: false });
  }
  candidateInTransaction(projectId: string, input: { assetId?: string; expectedVersionId?: string; metadata: ImageAssetMetadata }, files: {
    image: ImageFile; thumbnail: ImageFile; provenance: ImageAsset["provenance"];
  }) {
    if (Boolean(input.assetId) !== Boolean(input.expectedVersionId)) throw new Error("image_replacement_requires_exact_asset_and_version");
    const assetId = input.assetId ?? randomUUID(), current = this.head(projectId, assetId);
    if (input.assetId && (!current || current.id !== input.expectedVersionId)) throw new Error("image_asset_head_stale_reload_and_retry");
    this.saveFileInTransaction(projectId, files.image); this.saveFileInTransaction(projectId, files.thumbnail);
    return this.save(projectId, { schemaId: "cyoa.image-asset", schemaVersion: 1, assetId, status: "candidate", baseVersionId: current?.id ?? null,
      reviewedCandidateVersionId: null, fileSha256: files.image.sha256, thumbnailSha256: files.thumbnail.sha256,
      metadata: ImageAssetMetadataSchema.parse(input.metadata), provenance: files.provenance });
  }
  reviseInTransaction(projectId: string, assetId: string, expectedVersionId: string, metadata: ImageAssetMetadata) {
    const current = this.head(projectId, assetId);
    if (!current || current.id !== expectedVersionId) throw new Error("image_asset_head_stale_reload_and_retry");
    return this.save(projectId, { ...current.content, metadata: ImageAssetMetadataSchema.parse(metadata), status: "candidate", baseVersionId: current.id, reviewedCandidateVersionId: null });
  }
  reviewInTransaction(projectId: string, assetId: string, versionId: string, status: "approved" | "rejected") {
    const current = this.head(projectId, assetId);
    if (!current || current.id !== versionId || current.content.status !== "candidate") throw new Error("image_current_candidate_required_reload_and_review");
    return this.save(projectId, { ...current.content, status, baseVersionId: current.id, reviewedCandidateVersionId: current.id });
  }
  private save(projectId: string, content: ImageAsset) {
    return this.artifacts.saveArtifactInTransaction({ projectId, artifactId: imageAssetKey(content.assetId), artifactType: "image-asset", content: ImageAssetSchema.parse(content), markDependentsStale: false });
  }
}
