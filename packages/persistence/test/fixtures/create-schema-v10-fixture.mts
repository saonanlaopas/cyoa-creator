import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ArtifactRepository,
  DraftingRepository,
  openDatabase,
  PassageDraftRepository,
  PassagePlanRepository,
  ProjectRepository,
} from "../../src/index.js";

const output = fileURLToPath(new URL("./schema-v10.sqlite", import.meta.url));
rmSync(output, { force: true });
const database = openDatabase(output);
const projects = new ProjectRepository(database);
const artifacts = new ArtifactRepository(database);
const passages = new PassagePlanRepository(database);
const drafting = new DraftingRepository(database);
const drafts = new PassageDraftRepository(database);
const project = projects.create("Frozen v10 draft provenance", undefined, "long-form");
const brief = artifacts.saveArtifact({
  projectId: project.id,
  artifactId: "brief",
  content: { title: "Frozen v10 brief" },
});
const inputs = ["passage-1", "passage-2"].map((id, position) => ({
  kind: "passage" as const,
  id,
  content: { id, purpose: `Purpose ${position + 1}`, wordTarget: 500 },
}));
passages.initialize(project.id, {
  schemaVersion: 1,
  title: "Frozen v10 passage plan",
  projectWordTarget: 1_000,
  typicalPathWordTarget: 1_000,
  startPassageId: "passage-1",
  acts: [],
  sequences: [],
  characterAvailability: [],
}, inputs);
const snapshot = passages.createSnapshot(project.id, { brief: brief.id }, { findings: [] });
passages.approveSnapshot(project.id, snapshot.id);
const versions = inputs.map((input) => passages.currentEntity(project.id, "passage", input.id)!);
const plan = drafting.createPlan({
  projectId: project.id,
  fingerprint: "frozen-v10-drafting-plan",
  snapshotId: snapshot.id,
  structureVersionId: snapshot.structureVersionId,
  upstreamVersions: snapshot.upstreamVersions,
  scope: { kind: "passages", passageIds: inputs.map((input) => input.id) },
  providerId: "offline-fixture",
  modelId: "fixture-v1",
  estimatedInputTokens: 200,
  estimatedOutputTokens: 1_000,
  costEstimate: { status: "unavailable" },
  executionPolicyId: "passage-drafting-v1",
  executionPolicy: {
    id: "passage-drafting-v1",
    maxPassagesPerUnit: 8,
    maxUnitsPerPlan: 100,
    maxEstimatedInputTokensPerUnit: 48_000,
    maxOutputTokensPerPassage: 2_500,
    maxOutputTokensPerUnit: 12_000,
    maxAttemptsPerUnit: 3,
    maxSerializedCandidateBytes: 96_000,
  },
  units: versions.map((version, position) => ({
    id: `unit-${position + 1}`,
    position,
    passageIds: [version.entityId],
    passageVersionIds: [version.id],
    inputFingerprint: `frozen-input-${position + 1}`,
    estimatedInputTokens: 100,
    estimatedOutputTokens: 500,
    contextDiagnostics: { status: "not-built", passageIds: [version.entityId] },
  })),
});
const generated = drafts.createVersion({
  projectId: project.id,
  passageId: "passage-1",
  basedOnPassagePlanVersionId: versions[0]!.id,
  proseMarkdown: "Frozen generated draft provenance.",
  sourceKind: "generated",
  generationPlanId: plan.id,
  generationJobId: plan.jobId,
  generationUnitId: "unit-1",
  upstreamVersions: snapshot.upstreamVersions,
});
drafts.transition(project.id, "passage-1", generated.id, "accepted");

database.exec("DROP TRIGGER passage_draft_generation_input_insert");
database.exec("DROP TRIGGER passage_draft_generation_upstream_insert");
database.prepare("DELETE FROM schema_migrations WHERE version = 11").run();
database.exec("VACUUM");
database.close();
