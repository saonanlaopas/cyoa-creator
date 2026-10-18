import type { ImageAsset, ImageAssetMetadata } from "@story-to-cyoa/domain";
import type { ArtifactVersion } from "./long-form.js";
export type AssetVersion = ArtifactVersion<ImageAsset> & { image: { sha256: string; width: number; height: number; bytes: number; url: string }; thumbnail: { url: string } };
export type AssetDetail = { assetId: string; currentVersionId: string; selected: AssetVersion; approved: AssetVersion | null; totalVersions: number; offset: number;
  history: Array<{ id: string; version: number; createdAt: string; status: string; title: string; fileSha256: string }> };
export type AssetList = { total: number; offset: number; items: Array<{ assetId: string; versionId: string; status: string; metadata: Pick<ImageAssetMetadata, "title">; thumbnailUrl: string; approvedVersionId: string | null }> };
export type AssetReview = AssetDetail & { fingerprint: string; findings: Array<{ code: string; severity: string; message: string }>; usage: { totalAssignments: number; totalLibraryVersions: number } };
export const assetPath = (projectId: string) => `/api/long-form/projects/${encodeURIComponent(projectId)}/assets`;
export async function assetRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options), value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Asset request failed"); return value as T;
}
