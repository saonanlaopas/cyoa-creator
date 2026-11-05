import { AUTHORING_SETTINGS_ID, AuthoringInstructionsSchema, AuthoringSettingsSchema, sourceDigest, sourceCanonicalJson } from "@story-to-cyoa/domain";
/** Applies at direct writes, portable restore and history reads; never manufactures missing provenance. */
export function validateAuthoringInstructionArtifact(row: { project_id?: string; artifact_id: string; artifact_type: string; schema_version: number; content_json: string }): void {
  if (row.artifact_id === AUTHORING_SETTINGS_ID || row.artifact_type === AUTHORING_SETTINGS_ID) {
    if (row.artifact_id !== AUTHORING_SETTINGS_ID || row.artifact_type !== AUTHORING_SETTINGS_ID || row.schema_version !== 1) throw new Error("authoring_settings_identity_invalid");
    AuthoringSettingsSchema.parse(JSON.parse(row.content_json));
  }
  const draft = row.artifact_id.startsWith("draft-authoring-context:") || row.artifact_type === "draft-authoring-context";
  const quick = row.artifact_id === "quick-authoring-context" || row.artifact_type === "quick-authoring-context";
  if (!draft && !quick) return;
  if (draft && row.artifact_type !== "draft-authoring-context" || quick && row.artifact_type !== "quick-authoring-context") throw new Error("authoring_context_identity_invalid");
  if (row.schema_version !== 1) throw new Error("authoring_context_schema_invalid");
  const content = JSON.parse(row.content_json);
  const instructions = AuthoringInstructionsSchema.parse(content.authoringInstructions);
  if (content.schemaVersion !== 1 || sourceCanonicalJson(instructions) !== sourceCanonicalJson(content.authoringInstructions)) throw new Error("authoring_context_not_closed");
  if (row.artifact_type === "draft-authoring-context") {
    if ((row.project_id && content.binding?.projectId !== row.project_id) || content.binding?.context?.identity?.projectId !== content.binding?.projectId || row.artifact_id !== `draft-authoring-context:${content.draftVersionId}` || !content.binding || sourceDigest(content.binding) !== content.contextFingerprint
      || sourceCanonicalJson(content.binding.context?.authoringInstructions) !== sourceCanonicalJson(instructions)) throw new Error("draft_authoring_context_binding_invalid");
  } else {
    const { contextFingerprint, ...identity } = content;
    if ((row.project_id && content.projectId !== row.project_id) || row.artifact_id !== "quick-authoring-context" || sourceDigest(identity) !== contextFingerprint) throw new Error("quick_authoring_context_binding_invalid");
  }
}
