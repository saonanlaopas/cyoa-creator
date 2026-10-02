import { ADAPTATION_INTENT_LIMITS, AdaptationIntentSchema, AdaptationProposalSchema, adaptationBudget, assertAdaptationDossier, applyAdaptationOperations, newAdaptationIntent, normalizeAdaptationIntent,
  sourceCanonicalJson, sourceDigest, resolveSourceEvidence, type AdaptationIntent, type AdaptationProposal } from "@story-to-cyoa/domain";
import type { StoryDatabase } from "./database.js";
import { analysisBindingSource, assertAnalysisFresh, validateAnalysisPlan, validateDossierPersistence } from "./source-analysis-validation.js";

export function validateAdaptationIntent(database: StoryDatabase, projectId: string, value: unknown): AdaptationIntent {
  const intent = AdaptationIntentSchema.parse(value);
  const project = database.prepare("SELECT mode FROM projects WHERE id = ?").get(projectId) as { mode: string } | undefined;
  if (intent.projectId !== projectId || project?.mode !== "long-form") throw new Error("adaptation_project_invalid");
  const row = database.prepare("SELECT content_json FROM artifact_versions WHERE id = ? AND project_id = ? AND artifact_id = 'source-dossier' AND artifact_type = 'source-dossier' AND schema_version = 1")
    .get(intent.binding.dossierVersionId, projectId) as { content_json: string } | undefined;
  if (!row || !database.prepare("SELECT 1 FROM artifact_version_approvals WHERE project_id = ? AND artifact_id = 'source-dossier' AND version_id = ?")
    .get(projectId, intent.binding.dossierVersionId)) throw new Error("adaptation_approved_dossier_required");
  assertAdaptationDossier(intent, validateDossierPersistence(database, projectId, JSON.parse(row.content_json)));
  for (const versionId of [intent.revision.previousVersionId, intent.revision.restoredFromVersionId]) if (versionId && !database.prepare(
    "SELECT 1 FROM artifact_versions WHERE id = ? AND project_id = ? AND artifact_id = 'adaptation-intent'").get(versionId, projectId)) throw new Error("adaptation_revision_lineage_invalid");
  if (intent.revision.kind === "legacy-adoption" || intent.revision.legacyBriefVersionId) {
    const brief = database.prepare("SELECT content_json FROM artifact_versions WHERE id = ? AND project_id = ? AND artifact_id = 'brief'")
      .get(intent.revision.legacyBriefVersionId ?? "", projectId) as { content_json: string } | undefined;
    if (!brief || JSON.parse(brief.content_json).adaptationFidelity !== intent.revision.legacyFidelity) throw new Error("adaptation_legacy_brief_invalid");
  }
  return intent;
}
export function assertAdaptationFresh(database: StoryDatabase, intent: AdaptationIntent): void {
  const row = database.prepare("SELECT id,stale,content_json FROM artifact_versions WHERE project_id = ? AND artifact_id = 'source-dossier' ORDER BY version DESC LIMIT 1")
    .get(intent.projectId) as { id: string; stale: number; content_json: string } | undefined;
  const state = database.prepare("SELECT status,approved_version_id FROM artifact_workflow_state WHERE project_id = ? AND artifact_id = 'source-dossier'")
    .get(intent.projectId) as { status: string; approved_version_id: string } | undefined;
  if (!row || row.id !== intent.binding.dossierVersionId || row.stale || state?.status !== "approved" || state.approved_version_id !== row.id) throw new Error("adaptation_dossier_stale");
  const dossier = validateDossierPersistence(database, intent.projectId, JSON.parse(row.content_json));
  if (dossier.materialFingerprint !== intent.binding.dossierMaterialFingerprint) throw new Error("adaptation_dossier_stale");
  const plan = database.prepare("SELECT content_json FROM source_analysis_plans WHERE id = ? AND project_id = ?").get(dossier.planId, intent.projectId) as { content_json: string };
  assertAnalysisFresh(database, validateAnalysisPlan(database, JSON.parse(plan.content_json)));
}
export function assertAdaptationWrite(database: StoryDatabase, projectId: string, value: unknown): AdaptationIntent {
  const intent = validateAdaptationIntent(database, projectId, value);
  assertAdaptationFresh(database, intent);
  const current = database.prepare("SELECT id FROM artifact_versions WHERE project_id = ? AND artifact_id = 'adaptation-intent' ORDER BY version DESC LIMIT 1").get(projectId) as { id: string } | undefined;
  if ((current?.id ?? null) !== intent.revision.previousVersionId) throw new Error("adaptation_base_stale");
  const history = database.prepare("SELECT content_json FROM artifact_versions WHERE project_id = ? AND artifact_id = 'adaptation-intent'").all(projectId) as Array<{ content_json: string }>;
  const bytes = [...history.map((r) => r.content_json), JSON.stringify(intent)].reduce((sum, v) => sum + Buffer.byteLength(JSON.stringify(v)) + 1024, 0);
  if (history.length >= ADAPTATION_INTENT_LIMITS.history || bytes > ADAPTATION_INTENT_LIMITS.historyBytes) throw new Error("adaptation_history_budget_exceeded");
  return intent;
}
export function assertAdaptationApproval(database: StoryDatabase, projectId: string, versionId: string): void {
  const row = database.prepare("SELECT id,content_json,stale FROM artifact_versions WHERE project_id = ? AND artifact_id = 'adaptation-intent' ORDER BY version DESC LIMIT 1")
    .get(projectId) as { id: string; content_json: string; stale: number } | undefined;
  if (!row || row.id !== versionId || row.stale) throw new Error("adaptation_approval_requires_current_version");
  const intent = validateAdaptationIntent(database, projectId, JSON.parse(row.content_json));
  assertAdaptationFresh(database, intent);
  if (adaptationBudget(intent).status === "review-required" && !intent.budget.discrepancyReviewed) throw new Error("adaptation_budget_review_required");
  if (intent.overrides.some((o) => o.active && !o.reviewed) || intent.exceptions.some((e) => !e.reviewed)) throw new Error("adaptation_record_review_required");
}
export function validateAdaptationDatabase(database: StoryDatabase, projectId?: string): void {
  const rows = database.prepare(`SELECT id,project_id,artifact_id,artifact_type,schema_version,version,content_json FROM artifact_versions
    WHERE (artifact_id = 'adaptation-intent' OR artifact_type = 'adaptation-intent') ${projectId ? "AND project_id = ?" : ""} ORDER BY project_id,version`)
    .all(...(projectId ? [projectId] : [])) as Array<{ id: string; project_id: string; artifact_id: string; artifact_type: string; schema_version: number; version: number; content_json: string }>;
  const previous = new Map<string, string>();
  const histories = new Map<string, { count: number; bytes: number }>();
  for (const row of rows) {
    if (row.artifact_id !== "adaptation-intent" || row.artifact_type !== "adaptation-intent" || row.schema_version !== 1) throw new Error("adaptation_identity_invalid");
    const intent = validateAdaptationIntent(database, row.project_id, JSON.parse(row.content_json));
    if (intent.revision.previousVersionId !== (previous.get(row.project_id) ?? null)) throw new Error("adaptation_history_lineage_invalid");
    const history = histories.get(row.project_id) ?? { count: 0, bytes: 0 };
    history.count++; history.bytes += Buffer.byteLength(JSON.stringify(row.content_json)) + 1024;
    if (row.version !== history.count || history.count > ADAPTATION_INTENT_LIMITS.history || history.bytes > ADAPTATION_INTENT_LIMITS.historyBytes) throw new Error("adaptation_history_budget_or_sequence_invalid");
    histories.set(row.project_id, history);
    previous.set(row.project_id, row.id);
  }
  const proposals = database.prepare(`SELECT project_id,artifact_id,artifact_type,schema_version,content_json FROM artifact_versions
    WHERE (artifact_type = 'adaptation-intent-proposal' OR artifact_id LIKE 'adaptation-intent-proposal-%') ${projectId ? "AND project_id = ?" : ""}`)
    .all(...(projectId ? [projectId] : [])) as Array<{ project_id: string; artifact_id: string; artifact_type: string; schema_version: number; content_json: string }>;
  for (const row of proposals) {
    if (!row.artifact_id.startsWith("adaptation-intent-proposal-") || row.artifact_type !== "adaptation-intent-proposal" || row.schema_version !== 1) throw new Error("adaptation_proposal_identity_invalid");
    validateAdaptationProposal(database, row.project_id, JSON.parse(row.content_json));
  }
  for (const id of new Set(proposals.map((v) => v.project_id))) assertAdaptationProposalBudget(database, id);
}

export function assertAdaptationProposalBudget(database: StoryDatabase, projectId: string, additional?: unknown, reserve = false): void {
  const rows = database.prepare("SELECT content_json FROM artifact_versions WHERE project_id = ? AND artifact_type = 'adaptation-intent-proposal'").all(projectId) as Array<{ content_json: string }>;
  const contents = rows.map((v) => v.content_json); if (additional !== undefined) contents.push(JSON.stringify(additional));
  const bytes = contents.reduce((sum, v) => sum + Buffer.byteLength(JSON.stringify(v)) + 1024, reserve ? ADAPTATION_INTENT_LIMITS.bytes * 2 : 0);
  if (contents.length + (reserve ? 1 : 0) > ADAPTATION_INTENT_LIMITS.history || bytes > ADAPTATION_INTENT_LIMITS.historyBytes) throw new Error("adaptation_proposal_history_budget_exceeded");
}

export function adaptationSuggestionContext(database: StoryDatabase, projectId: string, binding: AdaptationIntent["binding"], baseVersionId: string | null, input: AdaptationProposal["input"]) {
  const dossierRow = database.prepare("SELECT content_json FROM artifact_versions WHERE id = ? AND project_id = ? AND artifact_id = 'source-dossier'").get(binding.dossierVersionId, projectId) as { content_json: string } | undefined;
  if (!dossierRow) throw new Error("adaptation_dossier_missing");
  const dossier = validateDossierPersistence(database, projectId, JSON.parse(dossierRow.content_json));
  const baseRow = baseVersionId ? database.prepare("SELECT content_json FROM artifact_versions WHERE id = ? AND project_id = ? AND artifact_id = 'adaptation-intent'").get(baseVersionId, projectId) as { content_json: string } | undefined : undefined;
  if (baseVersionId && !baseRow) throw new Error("adaptation_base_missing");
  const base = baseRow ? validateAdaptationIntent(database, projectId, JSON.parse(baseRow.content_json)) : newAdaptationIntent(projectId, binding);
  const source = analysisBindingSource(database, dossier.binding);
  const records = [...input.recordIds].sort().map((id) => {
    const record = dossier.records.find((r) => r.id === id && r.status === "supported");
    if (!record) throw new Error("adaptation_target_invalid");
    return { id: record.id, category: record.category, field: record.field, classification: record.classification, claim: record.claim,
      evidence: record.evidence.slice(0, 1).map((reference) => ({ reference, preview: resolveSourceEvidence(source, dossier.binding, reference).slice(0, ADAPTATION_INTENT_LIMITS.evidenceCharacters), truncated: reference.end - reference.start > ADAPTATION_INTENT_LIMITS.evidenceCharacters })) };
  });
  const context = { projectId, binding, baseVersionId, precondition: baseVersionId ? "exact-base" : "must-not-exist", baseMaterialFingerprint: base.materialFingerprint,
    promptVersion: "adaptation-intent-v1", schemaVersion: 1, providerId: input.providerId, modelId: input.modelId, request: input.request,
    dimensions: base.dimensions, budget: base.budget, preserveCanonRoute: base.preserveCanonRoute, endingIntent: base.endingIntent, records,
    activeOverrides: base.overrides.filter((o) => o.active && o.targetIds.some((id) => input.recordIds.includes(id))).slice(0, 32),
    obligations: base.obligations.filter((o) => o.targetIds.some((id) => input.recordIds.includes(id))).slice(0, 32) };
  const serialized = sourceCanonicalJson(context);
  // Reserve half the request budget for instructions, schema, and one bounded structural repair.
  if (Buffer.byteLength(serialized) > 20_000) throw new Error("adaptation_context_overflow");
  return { base, dossier, context, serialized, fingerprint: sourceDigest(context) };
}
export function validateAdaptationProposal(database: StoryDatabase, projectId: string, value: unknown): AdaptationProposal {
  const proposal = AdaptationProposalSchema.parse(value);
  if (proposal.projectId !== projectId || proposal.candidate.projectId !== projectId || sourceCanonicalJson(proposal.binding) !== sourceCanonicalJson(proposal.candidate.binding)) throw new Error("adaptation_proposal_project_invalid");
  const context = adaptationSuggestionContext(database, projectId, proposal.binding, proposal.baseVersionId, proposal.input);
  const expected = normalizeAdaptationIntent({ ...applyAdaptationOperations(context.base, proposal.suggestion, sourceDigest(proposal.input.request)),
    revision: { kind: "proposal", previousVersionId: proposal.baseVersionId, requestDigest: sourceDigest(proposal.input.request) } });
  if (proposal.contextFingerprint !== context.fingerprint || sourceCanonicalJson(expected) !== sourceCanonicalJson(proposal.candidate)) throw new Error("adaptation_proposal_derivation_invalid");
  validateAdaptationIntent(database, projectId, proposal.candidate);
  const reconciliation = adaptationBudget(proposal.candidate);
  if (reconciliation.difference !== null && reconciliation.difference < 0) throw new Error("adaptation_provider_budget_exceeded");
  if ((proposal.status === "applied") !== Boolean(proposal.appliedVersionId)) throw new Error("adaptation_proposal_lifecycle_invalid");
  if (proposal.appliedVersionId) {
    const row = database.prepare("SELECT content_json FROM artifact_versions WHERE id = ? AND project_id = ? AND artifact_id = 'adaptation-intent'").get(proposal.appliedVersionId, projectId) as { content_json: string } | undefined;
    if (!row || sourceCanonicalJson(JSON.parse(row.content_json)) !== sourceCanonicalJson(proposal.candidate)) throw new Error("adaptation_proposal_application_invalid");
  }
  return proposal;
}
