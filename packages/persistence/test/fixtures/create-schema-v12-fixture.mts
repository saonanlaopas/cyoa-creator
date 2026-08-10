import { copyFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DraftingRepository,
  openDatabase,
  PassageDraftRepository,
  PassagePlanRepository,
} from "../../src/index.js";

const source = fileURLToPath(new URL("./schema-v11.sqlite", import.meta.url));
const output = fileURLToPath(new URL("./schema-v12.sqlite", import.meta.url));
rmSync(output, { force: true });
copyFileSync(source, output);
const database = openDatabase(output);
const projectId = "fixture-project-v7";
const passagePlans = new PassagePlanRepository(database);
const snapshotRow = database.prepare(`SELECT id FROM passage_plan_snapshots
  WHERE project_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 1`)
  .get(projectId) as { id: string };
const snapshot = passagePlans.getSnapshot(snapshotRow.id)!;
const passage = passagePlans.snapshotEntities<Record<string, unknown>>(snapshot.id, "passage")[0]!;
const drafting = new DraftingRepository(database);
const contextFingerprint = "frozen-v12-context-fingerprint";
const plan = drafting.createPlan({
  projectId,
  fingerprint: "frozen-v12-drafting-plan",
  snapshotId: snapshot.id,
  structureVersionId: snapshot.structureVersionId,
  upstreamVersions: snapshot.upstreamVersions,
  scope: { kind: "passages", passageIds: [passage.entityId] },
  providerId: "offline-drafting-fixture",
  modelId: "deterministic-prose-v1",
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
    id: "frozen-v12-unit", position: 0, passageIds: [passage.entityId], passageVersionIds: [passage.id],
    inputFingerprint: "frozen-v12-input", estimatedInputTokens: 100, estimatedOutputTokens: 500,
    context: { schemaId: "cyoa.passage-drafting-context", schemaVersion: 1, acceptedNeighborProse: [] },
    contextFingerprint,
    contextDiagnostics: { status: "built", contextFingerprint },
  }],
});
drafting.authorize(projectId, plan.id, plan.fingerprint);
drafting.startJob(projectId, plan.jobId);
const { attemptId } = drafting.startUnit(projectId, plan.jobId, "frozen-v12-unit");
const drafts = new PassageDraftRepository(database);
drafting.completeUnitWithCandidates(projectId, plan.jobId, "frozen-v12-unit", attemptId, drafts, {
  contextFingerprint,
  providerId: "offline-drafting-fixture",
  modelId: "deterministic-prose-v1",
  outputSchemaId: "cyoa.passage-drafting-unit-output",
  outputSchemaVersion: 1,
  content: { passages: [passage.entityId] },
  validation: { valid: true },
  usage: { inputTokens: 100, outputTokens: 40, cost: 0 },
  repair: { maximumRepairs: 1, repairsPerformed: 0 },
  upstreamVersions: snapshot.upstreamVersions,
  neighboringDraftVersions: {},
  passages: [{
    passageId: passage.entityId,
    passagePlanVersionId: passage.id,
    proseMarkdown: "Frozen representative schema-v12 generated candidate.",
  }],
});
drafting.finalizeJob(projectId, plan.jobId);
for (const trigger of [
  "passage_draft_acceptance_items_lineage_insert",
  "passage_draft_acceptance_applications_immutable_update",
  "passage_draft_acceptance_applications_immutable_delete",
  "passage_draft_acceptance_items_immutable_update",
  "passage_draft_acceptance_items_immutable_delete",
]) database.exec(`DROP TRIGGER ${trigger}`);
database.exec("DROP INDEX passage_draft_acceptance_history");
database.exec("DROP INDEX passage_draft_acceptance_result");
database.exec("DROP TABLE passage_draft_acceptance_items");
database.exec("DROP TABLE passage_draft_acceptance_applications");
database.prepare("DELETE FROM schema_migrations WHERE version = 13").run();
database.exec("VACUUM");
database.close();
