import { randomUUID } from "node:crypto";
import { AdaptationIntentSchema, AdaptationProposalSchema, normalizeAdaptationIntent, type SourceDossier } from "@story-to-cyoa/domain";
import type { StoryDatabase } from "./database.js";
import { adaptationSuggestionContext } from "./adaptation-intent-validation.js";

export function prepareAdaptationDuplicate(database: StoryDatabase, projectId: string, ids: Map<string, string>): void {
  const rows = database.prepare("SELECT artifact_type,content_json FROM artifact_versions WHERE project_id = ? AND artifact_type IN ('adaptation-intent','adaptation-intent-proposal')").all(projectId) as Array<{ artifact_type: string; content_json: string }>;
  for (const row of rows) {
    const intent = AdaptationIntentSchema.parse(row.artifact_type === "adaptation-intent" ? JSON.parse(row.content_json) : JSON.parse(row.content_json).candidate);
    for (const item of [...intent.overrides, ...intent.inventions, ...intent.obligations, ...intent.exceptions, ...intent.expansion]) if (!ids.has(item.id)) ids.set(item.id, `ai_${randomUUID()}`);
  }
}
const references = new Set(["id", "projectId", "dossierVersionId", "sourceVersionId", "scopeVersionId", "scopeFingerprint", "targetIds", "sourceRecordIds",
  "overrideIds", "inventionIds", "dependencyIds", "obligationId", "previousVersionId", "restoredFromVersionId", "legacyBriefVersionId", "recordIds", "baseVersionId", "appliedVersionId"]);
function remap(value: unknown, ids: Map<string, string>, key = ""): unknown {
  return typeof value === "string" ? references.has(key) ? ids.get(value) ?? value : value
    : Array.isArray(value) ? value.map((item) => remap(item, ids, key)) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, item]) => [k, remap(item, ids, k)])) : value;
}
export function remapAdaptationIntent(database: StoryDatabase, value: unknown, ids: Map<string, string>) {
  const intent = remap(AdaptationIntentSchema.parse(value), ids) as ReturnType<typeof AdaptationIntentSchema.parse>;
  const row = database.prepare("SELECT content_json FROM artifact_versions WHERE id = ? AND project_id = ? AND artifact_id = 'source-dossier'").get(intent.binding.dossierVersionId, intent.projectId) as { content_json: string };
  const dossier = JSON.parse(row.content_json) as SourceDossier;
  intent.binding = { dossierVersionId: intent.binding.dossierVersionId, dossierMaterialFingerprint: dossier.materialFingerprint, source: dossier.binding };
  return normalizeAdaptationIntent(intent);
}
export function remapAdaptationProposal(database: StoryDatabase, value: unknown, ids: Map<string, string>) {
  const original = AdaptationProposalSchema.parse(value);
  const proposal = remap(original, ids) as typeof original;
  proposal.candidate = remapAdaptationIntent(database, original.candidate, ids);
  proposal.binding = proposal.candidate.binding;
  proposal.contextFingerprint = adaptationSuggestionContext(database, proposal.projectId, proposal.binding, proposal.baseVersionId, proposal.input).fingerprint;
  return AdaptationProposalSchema.parse(proposal);
}
