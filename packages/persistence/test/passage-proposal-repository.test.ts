import { describe, expect, it } from "vitest";
import {
  GenerationRepository,
  openDatabase,
  PassagePlanRepository,
  PassageProposalRepository,
  ProjectRepository,
} from "../src/index.js";

function setup() {
  const database = openDatabase();
  const projects = new ProjectRepository(database);
  const passages = new PassagePlanRepository(database);
  const generations = new GenerationRepository(database);
  const proposals = new PassageProposalRepository(database);
  const project = projects.create("Proposal persistence", undefined, "long-form");
  passages.initialize(project.id, { schemaVersion: 1, acts: [], sequences: [] }, [{
    kind: "passage", id: "passage-a", content: { id: "passage-a", title: "Before" },
  }]);
  const passageVersion = passages.currentEntity(project.id, "passage", "passage-a")!;
  const snapshot = passages.createSnapshot(project.id, { brief: "brief-v1" }, { findings: [] });
  passages.approveSnapshot(project.id, snapshot.id);
  const plan = generations.createPlan({
    projectId: project.id,
    fingerprint: "plan-fingerprint",
    snapshotId: snapshot.id,
    structureVersionId: snapshot.structureVersionId,
    upstreamVersions: { brief: "brief-v1" },
    scope: { kind: "sequence", sequenceId: "sequence-a" },
    providerId: "offline-kernel",
    modelId: "fixture-v1",
    estimatedInputTokens: 10,
    estimatedOutputTokens: 20,
    costEstimate: { status: "unavailable" },
    validationStages: ["schema"],
    executionPolicyId: "fixture-policy",
    executionPolicy: { maxAttemptsPerUnit: 3 },
    units: [{
      id: "unit-a", position: 0, sequenceId: "sequence-a", passageIds: ["passage-a"],
      passageVersionIds: [passageVersion.id], inputFingerprint: "input-a",
      estimatedInputTokens: 10, estimatedOutputTokens: 20,
      contextFingerprint: "context-a", context: { selected: ["passage-a"] },
      contextDiagnostics: { contextFingerprint: "context-a" },
    }],
  });
  generations.authorize(project.id, plan.id, plan.fingerprint);
  generations.startJob(project.id, plan.jobId);
  const attempt = generations.startUnit(project.id, plan.jobId, "unit-a");
  generations.completeUnitWithCandidate(project.id, plan.jobId, "unit-a", attempt.attemptId, {
    id: "candidate-a", contextFingerprint: "context-a", providerId: "offline-kernel", modelId: "fixture-v1",
    outputSchemaId: "cyoa.passage-planning-unit-candidate", outputSchemaVersion: 1,
    content: { candidate: true }, validation: { valid: true }, repair: { repairsPerformed: 0 },
  });
  generations.finalizeJob(project.id, plan.jobId);
  const candidate = generations.getCandidate(project.id, "candidate-a")!;
  return { database, projects, passages, generations, proposals, project, passageVersion, snapshot, plan, candidate };
}

const proposalInput = (fixture: ReturnType<typeof setup>) => ({
  id: "proposal-a",
  projectId: fixture.project.id,
  generationPlanId: fixture.plan.id,
  generationJobId: fixture.plan.jobId,
  generationPlanFingerprint: fixture.plan.fingerprint,
  snapshotId: fixture.snapshot.id,
  proposalSchemaId: "cyoa.passage-planning-proposal-set",
  proposalSchemaVersion: 1,
  candidates: [{
    candidateId: fixture.candidate.id,
    attemptId: fixture.candidate.attemptId,
    unitId: fixture.candidate.unitId,
    unitPosition: 0,
    inputFingerprint: fixture.candidate.inputFingerprint,
    contextFingerprint: fixture.candidate.contextFingerprint,
    candidateFingerprint: "candidate-fingerprint",
  }],
  consolidationFingerprint: "consolidation-fingerprint",
  groups: [{
    id: "group-a", unitId: "unit-a", position: 0, label: "Unit 1", summary: "One passage",
    operationIds: ["operation-a"], dependsOnGroupIds: [], affectedEntityIds: ["passage:passage-a"],
    downstreamInvalidations: ["passage-plan-validation"], validationFindingIds: [],
    safeToApplyIndependently: true,
  }],
  operations: [{
    id: "operation-a", kind: "update-entity" as const, entityKind: "passage" as const,
    entityId: "passage-a", baseVersionId: fixture.passageVersion.id,
    before: { id: "passage-a", title: "Before" }, after: { id: "passage-a", title: "After" },
    fieldDiffs: [{ field: "title", before: "Before", after: "After" }], sourceCandidateIds: ["candidate-a"],
  }],
});

describe("PassageProposalRepository", () => {
  it("persists immutable definitions, previews, audit provenance, lifecycle, and project cascades", () => {
    const fixture = setup();
    const created = fixture.proposals.create(proposalInput(fixture));
    expect(created).toMatchObject({
      id: "proposal-a", projectId: fixture.project.id, generationPlanId: fixture.plan.id,
      generationJobId: fixture.plan.jobId, candidateIds: ["candidate-a"], status: "proposed",
      groups: [{ id: "group-a", status: "proposed", operations: [{ id: "operation-a" }] }],
    });
    expect(fixture.proposals.create(proposalInput(fixture))).toEqual(created);
    expect(() => fixture.database.prepare("UPDATE passage_proposal_sets SET consolidation_fingerprint = 'changed' WHERE id = 'proposal-a'").run())
      .toThrow("immutable");
    expect(() => fixture.database.prepare("UPDATE passage_proposal_groups SET label = 'changed' WHERE id = 'group-a'").run())
      .toThrow("immutable");
    expect(() => fixture.database.prepare("UPDATE passage_proposal_operations SET entity_id = 'changed' WHERE id = 'operation-a'").run())
      .toThrow("immutable");
    expect(() => fixture.database.prepare("DELETE FROM passage_proposal_operations WHERE id = 'operation-a'").run())
      .toThrow("immutable");
    expect(() => fixture.database.prepare("DELETE FROM passage_proposal_sets WHERE id = 'proposal-a'").run())
      .toThrow("immutable");
    expect(() => fixture.database.prepare(`INSERT INTO passage_proposal_groups (
      proposal_id, project_id, id, position, generation_unit_id, label, summary,
      operation_ids_json, depends_on_group_ids_json, affected_entity_ids_json,
      downstream_invalidations_json, validation_finding_ids_json, safe_independently,
      status, created_at, updated_at
    ) VALUES ('proposal-a', ?, 'wrong-unit-group', 1, 'wrong-unit', 'Wrong', 'Wrong',
      '[]', '[]', '[]', '[]', '[]', 0, 'proposed', ?, ?)`)
      .run(fixture.project.id, "2026-08-10T00:00:00.000Z", "2026-08-10T00:00:00.000Z"))
      .toThrow("group unit lineage mismatch");
    expect(() => fixture.database.prepare(`INSERT INTO passage_proposal_operations (
      proposal_id, project_id, group_id, id, position, operation_kind, entity_kind,
      entity_id, base_version_id, before_json, after_json, field_diffs_json, source_candidate_ids_json
    ) VALUES ('proposal-a', ?, 'group-a', 'wrong-base-operation', 1, 'update-entity', 'choice',
      'choice-a', ?, '{}', '{}', '[]', '["candidate-a"]')`)
      .run(fixture.project.id, fixture.passageVersion.id))
      .toThrow("operation base lineage mismatch");

    const preview = fixture.proposals.savePreview({
      projectId: fixture.project.id, proposalId: created.id, selectedGroupIds: ["group-a"],
      selectedOperationIds: ["operation-a"], headVersions: { "passage:passage-a": fixture.passageVersion.id },
      validation: { findings: [] }, affectedEntityIds: ["passage:passage-a"],
      downstreamInvalidations: ["passage-plan-validation"], beforeAfter: [{ operationId: "operation-a" }],
      previewFingerprint: "preview-fingerprint", valid: true,
    });
    expect(preview.valid).toBe(true);
    expect(() => fixture.database.prepare("UPDATE passage_proposal_previews SET valid = 0 WHERE id = ?").run(preview.id))
      .toThrow("immutable");
    fixture.proposals.insertApplication({
      projectId: fixture.project.id, proposalId: created.id, selectedGroupIds: ["group-a"],
      appliedOperationIds: ["operation-a"], candidateProvenance: created.candidates,
      previousVersionIds: { "passage:passage-a": fixture.passageVersion.id },
      resultingVersionIds: { "passage:passage-a": "new-version" },
      affectedEntityIds: ["passage:passage-a"], validationPreviewFingerprint: preview.previewFingerprint,
      validation: { findings: [] }, downstreamInvalidations: ["passage-plan-validation"],
    }, "2026-08-10T00:00:00.000Z");
    expect(fixture.proposals.listApplications(fixture.project.id, created.id)).toHaveLength(1);

    expect(() => fixture.database.prepare("DELETE FROM projects WHERE id = ?").run(fixture.project.id)).not.toThrow();
    expect((fixture.database.prepare("SELECT COUNT(*) count FROM passage_proposal_sets").get() as { count: number }).count).toBe(0);
    expect((fixture.database.prepare("SELECT COUNT(*) count FROM passage_proposal_applications").get() as { count: number }).count).toBe(0);
    fixture.database.close();
  });

  it("rejects cross-project and mismatched candidate provenance at the database boundary", () => {
    const fixture = setup();
    const invalid = proposalInput(fixture);
    invalid.candidates[0]!.attemptId = "wrong-attempt";
    expect(() => fixture.proposals.create(invalid)).toThrow("candidate lineage mismatch");
    expect(fixture.proposals.list(fixture.project.id)).toEqual([]);

    const other = fixture.projects.create("Other", undefined, "long-form");
    expect(() => fixture.database.prepare(`INSERT INTO passage_proposal_sets (
      id, project_id, generation_plan_id, generation_job_id, generation_plan_fingerprint,
      passage_snapshot_id, proposal_schema_id, proposal_schema_version, candidate_ids_json,
      candidate_provenance_json, consolidation_fingerprint, status, created_at, updated_at
    ) VALUES ('cross-project', ?, ?, ?, ?, ?, 'schema', 1, '[]', '[]', 'fingerprint', 'proposed', ?, ?)`)
      .run(other.id, fixture.plan.id, fixture.plan.jobId, fixture.plan.fingerprint, fixture.snapshot.id,
        "2026-08-10T00:00:00.000Z", "2026-08-10T00:00:00.000Z"))
      .toThrow();
    fixture.database.close();
  });
});
