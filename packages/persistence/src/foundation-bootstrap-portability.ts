import { FOUNDATION_ARTIFACT_IDS, CreativeDirectionSchema, normalizeCreativeDirection, sourceCanonicalJson, sourceDigest,
  type CreativeDirection, type FoundationArtifactId, type FoundationBootstrapCandidate } from "@story-to-cyoa/domain";
import { FoundationBootstrapApplicationSchema, FoundationBootstrapJobSchema, FoundationBootstrapPlanSchema, orderFoundationBootstrapApplications } from "./foundation-bootstrap-repository.js";
import type { PortableProjectRows } from "./portable-project-repository.js";

export function unavailableConversationEvidence(direction: CreativeDirection): CreativeDirection {
  direction = CreativeDirectionSchema.parse(direction);
  return normalizeCreativeDirection({ ...direction, fieldProvenance: direction.fieldProvenance.map((entry) =>
    entry.reference && ["user-message", "proposal"].includes(entry.reference.kind)
      ? { ...entry, reference: { ...entry.reference, unavailable: true } } : entry) });
}

/** Transform only the exported copy, consistently resealing all exact references to redacted evidence. */
export function redactFoundationBootstrapRows(bundle: PortableProjectRows): void {
  const plans = new Map(bundle.tables.foundation_bootstrap_plans.map((row) => [String(row.id), FoundationBootstrapPlanSchema.parse(JSON.parse(String(row.content_json)))]));
  const jobs = new Map(bundle.tables.foundation_bootstrap_jobs.map((row) => [String(row.id), FoundationBootstrapJobSchema.parse(JSON.parse(String(row.content_json)))]));
  const applications = bundle.tables.foundation_bootstrap_applications.map((row) => FoundationBootstrapApplicationSchema.parse(JSON.parse(String(row.content_json))));
  const ordered = [...jobs.values()].flatMap((job) => orderFoundationBootstrapApplications(applications.filter((application) => application.jobId === job.id), plans.get(job.planId)!.fingerprint));
  for (const row of bundle.tables.foundation_bootstrap_plans) {
    const plan = plans.get(String(row.id))!;
    const staticInputTokens = plan.estimatedInputTokens - Math.ceil(plan.contextBytes / 4);
    if (plan.context.baseArtifacts["creative-direction"]) plan.context.baseArtifacts["creative-direction"] = unavailableConversationEvidence(plan.context.baseArtifacts["creative-direction"]);
    plan.contextFingerprint = sourceDigest(plan.context);
    plan.fingerprint = sourceDigest({ contextFingerprint: plan.contextFingerprint, units: plan.units, providerId: plan.providerId, modelId: plan.modelId });
    plan.contextBytes = Buffer.byteLength(sourceCanonicalJson(plan.context)); plan.estimatedInputTokens = Math.ceil(plan.contextBytes / 4) + staticInputTokens;
    row.content_json = JSON.stringify(plan);
  }
  for (const row of bundle.tables.foundation_bootstrap_jobs) {
    const job = jobs.get(String(row.id))!, plan = plans.get(job.planId)!;
    job.authorizedFingerprint = plan.fingerprint;
    for (const attempt of job.units[0].attempts) attempt.contextFingerprint = plan.contextFingerprint;
    row.content_json = JSON.stringify(job);
  }
  for (const row of bundle.tables.foundation_bootstrap_candidates) {
    const candidate = JSON.parse(String(row.content_json)) as FoundationBootstrapCandidate;
    candidate.artifacts["creative-direction"] = unavailableConversationEvidence(candidate.artifacts["creative-direction"]);
    row.content_json = JSON.stringify(candidate);
  }
  const rows = new Map(bundle.tables.foundation_bootstrap_applications.map((row) => [String(row.id), row]));
  const priorApplied = new Map<string, Partial<Record<FoundationArtifactId, string>>>();
  for (const application of ordered) {
    const job = jobs.get(application.jobId)!, applied = priorApplied.get(job.id) ?? {};
    application.fingerprint = sourceDigest({ plan: job.authorizedFingerprint, candidateId: application.candidateId, applied,
      effectiveArtifactIds: FOUNDATION_ARTIFACT_IDS.filter((artifactId) => application.artifactVersionIds[artifactId]) });
    priorApplied.set(job.id, { ...applied, ...application.artifactVersionIds });
    rows.get(application.id)!.content_json = JSON.stringify(application);
  }
}
