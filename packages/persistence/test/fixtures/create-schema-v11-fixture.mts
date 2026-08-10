import { copyFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DraftingRepository,
  openDatabase,
  PassageDraftRepository,
  PassagePlanRepository,
} from "../../src/index.js";

const source = fileURLToPath(new URL("./schema-v9.sqlite", import.meta.url));
const output = fileURLToPath(new URL("./schema-v11.sqlite", import.meta.url));
rmSync(output, { force: true });
copyFileSync(source, output);
const database = openDatabase(output);
const projectId = "fixture-project-v7";
database.prepare(`INSERT OR IGNORE INTO artifact_versions (
  id, project_id, artifact_id, artifact_type, version, schema_version, content_json, stale, created_at
) VALUES ('brief-v1', ?, 'brief', 'brief', 1, 1, '{"workingTitle":"Frozen v11 brief"}', 0, '2026-08-10T00:00:00.000Z')`)
  .run(projectId);
const passagePlans = new PassagePlanRepository(database);
const snapshot = database.prepare(`SELECT id FROM passage_plan_snapshots
  WHERE project_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 1`)
  .get(projectId) as { id: string };
const exactSnapshot = passagePlans.getSnapshot(snapshot.id)!;
const passage = passagePlans.snapshotEntities<Record<string, unknown>>(snapshot.id, "passage")[0]!;
const drafting = new DraftingRepository(database);
const plan = drafting.createPlan({
  projectId,
  fingerprint: "frozen-v11-drafting-plan",
  snapshotId: snapshot.id,
  structureVersionId: exactSnapshot.structureVersionId,
  upstreamVersions: exactSnapshot.upstreamVersions,
  scope: { kind: "passages", passageIds: [passage.entityId] },
  providerId: "offline-drafting-lifecycle",
  modelId: "no-prose-v1",
  estimatedInputTokens: 100,
  estimatedOutputTokens: 500,
  costEstimate: { status: "unavailable" },
  executionPolicyId: "passage-drafting-v1",
  executionPolicy: {
    id: "passage-drafting-v1", maxPassagesPerUnit: 8, maxUnitsPerPlan: 100,
    maxEstimatedInputTokensPerUnit: 48_000, maxOutputTokensPerPassage: 2_500,
    maxOutputTokensPerUnit: 12_000, maxAttemptsPerUnit: 3, maxSerializedCandidateBytes: 96_000,
  },
  units: [{
    id: "frozen-v11-unit", position: 0, passageIds: [passage.entityId], passageVersionIds: [passage.id],
    inputFingerprint: "frozen-v11-input", estimatedInputTokens: 100, estimatedOutputTokens: 500,
    contextDiagnostics: { status: "not-built", passageIds: [passage.entityId] },
  }],
});
drafting.authorize(projectId, plan.id, plan.fingerprint);
drafting.startJob(projectId, plan.jobId);
const attempt = drafting.startUnit(projectId, plan.jobId, "frozen-v11-unit");
drafting.failUnit(projectId, plan.jobId, "frozen-v11-unit", attempt.attemptId, {
  code: "frozen_failure", message: "Representative failed attempt", retryable: true,
});
drafting.finalizeJob(projectId, plan.jobId);
const drafts = new PassageDraftRepository(database);
const generated = drafts.createVersion({
  projectId,
  passageId: passage.entityId,
  basedOnPassagePlanVersionId: passage.id,
  proseMarkdown: "Frozen representative 4B-1 generated draft.",
  sourceKind: "generated",
  generationPlanId: plan.id,
  generationJobId: plan.jobId,
  generationUnitId: "frozen-v11-unit",
  upstreamVersions: exactSnapshot.upstreamVersions,
});
const accepted = drafts.transition(projectId, passage.entityId, generated.id, "accepted");
const reviewed = drafts.transition(projectId, passage.entityId, accepted.id, "reviewed");
drafts.transition(projectId, passage.entityId, reviewed.id, "locked");

for (const trigger of [
  "drafting_unit_outputs_lineage_insert", "passage_draft_generation_provenance_insert",
  "drafting_unit_outputs_immutable_update", "drafting_unit_outputs_immutable_delete",
  "passage_draft_generation_provenance_immutable_update", "passage_draft_generation_provenance_immutable_delete",
]) database.exec(`DROP TRIGGER ${trigger}`);
database.exec("DROP TABLE passage_draft_generation_provenance");
database.exec("DROP TABLE drafting_unit_outputs");
database.exec("DROP INDEX drafting_plan_unit_passage_generation_identity");
database.exec("ALTER TABLE drafting_plan_units DROP COLUMN context_fingerprint");
database.exec("ALTER TABLE drafting_plan_units DROP COLUMN context_json");
database.prepare("DELETE FROM schema_migrations WHERE version = 12").run();
database.exec("VACUUM");
database.close();
