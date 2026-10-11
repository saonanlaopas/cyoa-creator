import { AnalysisSourceSchema, SourceEvidenceMaterialSchema, UnavailableSourceSchema, isUnavailableSource, sourceCanonicalJson, sourceDigest, unavailableSource,
  type SourceEvidenceMaterial } from "@story-to-cyoa/domain";
import type { StoryDatabase } from "./database.js";

export function readSourceMaterial(database: StoryDatabase, projectId: string, versionId: string): SourceEvidenceMaterial {
  const row = database.prepare("SELECT content_json FROM artifact_versions WHERE project_id=? AND id=? AND artifact_id='source' AND artifact_type='source'").get(projectId, versionId) as { content_json: string } | undefined;
  if (!row) throw new Error("source_analysis_binding_missing");
  const value: unknown = JSON.parse(row.content_json);
  if (!isUnavailableSource(value)) return AnalysisSourceSchema.parse(value);
  const index = UnavailableSourceSchema.parse(value);
  const attachments = database.prepare("SELECT artifact_id,schema_version,content_json FROM artifact_versions WHERE project_id=? AND artifact_type='source-evidence-material' AND json_extract(content_json,'$.sourceVersionId')=?")
    .all(projectId, versionId) as { artifact_id: string; schema_version: number; content_json: string }[];
  if (!attachments.length) return index;
  for (const row of attachments) {
    const attached = SourceEvidenceMaterialSchema.parse(JSON.parse(row.content_json));
    if (row.schema_version !== 1 || row.artifact_id !== `source-evidence-material-${versionId}` || attached.projectId !== projectId || attached.sourceVersionId !== versionId
      || attached.sourceFingerprint !== index.sourceFingerprint || sourceDigest(attached.source) !== index.sourceFingerprint
      || sourceCanonicalJson({ ...unavailableSource(attached.source), availability: index.availability }) !== sourceCanonicalJson(index)) throw new Error("source_reattachment_lineage_invalid");
  }
  return SourceEvidenceMaterialSchema.parse(JSON.parse(attachments[0]!.content_json)).source;
}
