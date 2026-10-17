import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { IMAGE_ASSET_LIMITS, ImageAssetSchema, ImageFileSchema, sourceCanonicalJson, type ImageFile } from "@story-to-cyoa/domain";
import type { StoryDatabase } from "./database.js";

export const imageSha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const imageFileKey = (hash: string) => `image-file:${hash}`;
export const imageAssetKey = (id: string) => `image-asset:${id}`;
export function imageFileMetadata(database: StoryDatabase, projectId: string, hash: string) {
  const file = database.prepare(`SELECT json_extract(content_json,'$.sha256') sha256,json_extract(content_json,'$.width') width,
    json_extract(content_json,'$.height') height,json_extract(content_json,'$.bytes') bytes FROM artifact_versions
    WHERE project_id=? AND artifact_id=? AND artifact_type='image-file' AND version=1`).get(projectId, imageFileKey(hash)) as Pick<ImageFile, "sha256" | "width" | "height" | "bytes"> | undefined;
  if (!file || file.sha256 !== hash) throw new Error("image_asset_file_missing");
  return file;
}
export function encodeAssetPng(width: number, height: number, data: Buffer): ImageFile {
  if (width < 1 || height < 1 || width > IMAGE_ASSET_LIMITS.side || height > IMAGE_ASSET_LIMITS.side || width * height > IMAGE_ASSET_LIMITS.pixels
    || data.length !== width * height * 4) throw new Error("image_dimensions_exceeded");
  const png = new PNG(); png.width = width; png.height = height; png.data = data;
  const bytes = PNG.sync.write(png, { colorType: 6, inputColorType: 6, inputHasAlpha: true });
  return ImageFileSchema.parse({ schemaId: "cyoa.image-file", schemaVersion: 1, sha256: imageSha256(bytes), mimeType: "image/png", width, height, bytes: bytes.length, base64: bytes.toString("base64") });
}
export function validateImageFile(value: unknown): ImageFile {
  const file = ImageFileSchema.parse(value), bytes = Buffer.from(file.base64, "base64");
  if (sourceCanonicalJson(file) !== sourceCanonicalJson(value) || bytes.toString("base64") !== file.base64 || bytes.length !== file.bytes || imageSha256(bytes) !== file.sha256) throw new Error("image_file_integrity_invalid");
  // Bound dimensions before the PNG parser allocates its decompressed pixel buffer.
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(16) !== file.width || bytes.readUInt32BE(20) !== file.height
    || file.width * file.height > IMAGE_ASSET_LIMITS.pixels) throw new Error("image_file_dimensions_invalid");
  const decoded = PNG.sync.read(bytes, { checkCRC: true });
  const canonical = encodeAssetPng(decoded.width, decoded.height, decoded.data);
  if (canonical.sha256 !== file.sha256) throw new Error("image_file_not_canonical: metadata and unknown chunks are not retained");
  return file;
}
type AssetRow = { id: string; project_id: string; artifact_id: string; artifact_type: string; version: number; schema_version: number; content_json: string };
function previous(database: StoryDatabase, projectId: string, key: string, version: number) {
  return database.prepare("SELECT * FROM artifact_versions WHERE project_id=? AND artifact_id=? AND version=?").get(projectId, key, version - 1) as AssetRow | undefined;
}
export function assertImageArtifact(database: StoryDatabase, row: AssetRow, value: unknown): void {
  if (row.schema_version !== 1) throw new Error("image_schema_unsupported");
  if (row.artifact_type === "image-file") {
    const file = validateImageFile(value);
    if (row.artifact_id !== imageFileKey(file.sha256) || row.version !== 1) throw new Error("image_file_identity_invalid");
    return;
  }
  const asset = ImageAssetSchema.parse(value), prior = previous(database, row.project_id, row.artifact_id, row.version);
  if (row.artifact_type !== "image-asset" || row.artifact_id !== imageAssetKey(asset.assetId) || sourceCanonicalJson(asset) !== sourceCanonicalJson(value)
    || asset.baseVersionId !== (prior?.id ?? null) || (row.version > 1) !== Boolean(prior)) throw new Error("image_asset_lineage_invalid");
  if (asset.status === "candidate") {
    if (asset.reviewedCandidateVersionId !== null) throw new Error("image_candidate_review_invalid");
  } else {
    if (!prior || asset.reviewedCandidateVersionId !== prior.id) throw new Error("image_review_lineage_invalid");
    const before = ImageAssetSchema.parse(JSON.parse(prior.content_json));
    if (before.status !== "candidate" || sourceCanonicalJson({ ...asset, status: "candidate", baseVersionId: before.baseVersionId, reviewedCandidateVersionId: null }) !== sourceCanonicalJson(before)) throw new Error("image_review_content_changed");
  }
  for (const [hash, thumbnail] of [[asset.fileSha256, false], [asset.thumbnailSha256, true]] as const) {
    const file = imageFileMetadata(database, row.project_id, hash);
    if (file.sha256 !== hash || thumbnail && (file.width > IMAGE_ASSET_LIMITS.thumbnailSide || file.height > IMAGE_ASSET_LIMITS.thumbnailSide || file.bytes > IMAGE_ASSET_LIMITS.thumbnailBytes)) throw new Error("image_thumbnail_invalid");
  }
}
export function validateImageAssets(database: StoryDatabase, projectId: string): void {
  const rows = database.prepare("SELECT * FROM artifact_versions WHERE project_id=? AND (artifact_type IN ('image-file','image-asset') OR artifact_id LIKE 'image-file:%' OR artifact_id LIKE 'image-asset:%') ORDER BY artifact_id,version").all(projectId) as AssetRow[];
  let bytes = 0, versions = 0; const assets = new Set<string>();
  for (const row of rows) {
    const value = JSON.parse(row.content_json);
    assertImageArtifact(database, row, value);
    if (row.artifact_type === "image-file") bytes += ImageFileSchema.parse(value).bytes;
    else { versions++; assets.add(row.artifact_id); }
  }
  if (bytes > IMAGE_ASSET_LIMITS.projectFileBytes || assets.size > IMAGE_ASSET_LIMITS.assets || versions > IMAGE_ASSET_LIMITS.versions) throw new Error("image_project_budget_exceeded");
}
