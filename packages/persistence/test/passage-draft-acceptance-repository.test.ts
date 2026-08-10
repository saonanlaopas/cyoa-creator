import { afterEach, describe, expect, it } from "vitest";
import {
  ArtifactRepository,
  openDatabase,
  PassageDraftAcceptanceRepository,
  PassageDraftRepository,
  PassagePlanRepository,
  ProjectRepository,
  transaction,
  WorkflowRepository,
} from "../src/index.js";

const passage = (id: string, position: number) => ({
  id, sequenceId: "sequence-1", title: `Passage ${id}`, kind: "scene", purpose: "Purpose",
  summary: "Summary", wordTarget: 100, routeIds: [], tags: [], characterIds: [], relationshipIds: [],
  locationIds: [], requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [],
  preservedDifferenceIds: [], choiceIds: [], terminal: true, endingId: null, draftingNotes: [],
  unresolvedQuestions: [], planningStatus: "planned", position,
});

function setup() {
  const database = openDatabase();
  const projects = new ProjectRepository(database);
  const artifacts = new ArtifactRepository(database);
  const workflow = new WorkflowRepository(database);
  const drafts = new PassageDraftRepository(database);
  const passages = new PassagePlanRepository(database, (mutation) => drafts.handlePassagePlanMutationInTransaction(mutation));
  const acceptance = new PassageDraftAcceptanceRepository(database, drafts);
  const project = projects.create("Acceptance", undefined, "long-form");
  const upstreamVersions = Object.fromEntries(["brief", "bible", "routes", "endings", "mechanics"].map((artifactId) => {
    const version = artifacts.saveArtifact({ projectId: project.id, artifactId, content: { artifactId } });
    workflow.approve(project.id, artifactId, version.id);
    return [artifactId, version.id];
  }));
  passages.initialize(project.id, {
    schemaVersion: 1, title: "Plan", projectWordTarget: 400, typicalPathWordTarget: 400,
    startPassageId: "passage-1", acts: [{ id: "act-1" }],
    sequences: [{ id: "sequence-1", actId: "act-1" }], characterAvailability: [],
  }, [1, 2, 3, 4].map((number) => ({ kind: "passage" as const, id: `passage-${number}`, content: passage(`passage-${number}`, number - 1) })));
  return { database, projects, artifacts, workflow, drafts, passages, acceptance, project, upstreamVersions };
}

function candidate(fixture: ReturnType<typeof setup>, passageId: string, prose: string, neighbors: Record<string, string> = {}) {
  const base = fixture.passages.currentEntity(fixture.project.id, "passage", passageId)!;
  return fixture.drafts.createVersion({
    projectId: fixture.project.id, passageId, basedOnPassagePlanVersionId: base.id,
    proseMarkdown: prose, sourceKind: "manual", upstreamVersions: fixture.upstreamVersions,
    neighboringDraftVersions: neighbors,
  });
}

function apply(fixture: ReturnType<typeof setup>, selections: Array<{ passageId: string; candidateDraftVersionId: string }>) {
  const preview = fixture.acceptance.preview(fixture.project.id, selections);
  if (!preview.valid) throw new Error(`Invalid preview: ${preview.issues.map((item) => item.code).join(",")}`);
  return transaction(fixture.database, () => {
    const current = fixture.acceptance.preview(fixture.project.id, selections);
    expect(current.fingerprint).toBe(preview.fingerprint);
    return fixture.acceptance.applyInTransaction(current);
  });
}

const openDatabases: ReturnType<typeof setup>[] = [];
afterEach(() => openDatabases.splice(0).forEach((fixture) => fixture.database.close()));
const fixture = () => { const value = setup(); openDatabases.push(value); return value; };

describe("passage draft acceptance repository", () => {
  it("previews without writes and accepts the exact manual candidate as immutable audited history", () => {
    const f = fixture();
    const first = candidate(f, "passage-1", "First candidate words");
    const second = candidate(f, "passage-1", "Exact selected second candidate");
    const selection = [{ passageId: "passage-1", candidateDraftVersionId: first.id }];
    const before = f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_versions").get() as { count: number };
    const previewA = f.acceptance.preview(f.project.id, selection);
    const previewB = f.acceptance.preview(f.project.id, selection);
    expect(previewA).toMatchObject({ valid: true, fingerprint: previewB.fingerprint, acceptedWordDelta: 3, acceptedPassageDelta: 1 });
    expect((f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_versions").get() as { count: number }).count).toBe(before.count);
    expect((f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_acceptance_applications").get() as { count: number }).count).toBe(0);

    const application = apply(f, selection);
    const acceptedHead = f.drafts.getHead(f.project.id, "passage-1")!;
    const accepted = acceptedHead.accepted!;
    expect(accepted).toMatchObject({ id: application.resultingAcceptedVersions["passage-1"], lifecycleStatus: "accepted", proseMarkdown: first.proseMarkdown });
    expect(acceptedHead.current.id).toBe(second.id);
    expect(f.drafts.projectSummary(f.project.id).currentCandidateCount).toBe(1);
    expect(f.drafts.getVersion(f.project.id, first.id)).toMatchObject({ lifecycleStatus: "candidate", proseMarkdown: first.proseMarkdown });
    expect(f.drafts.getVersion(f.project.id, second.id)).toMatchObject({ lifecycleStatus: "candidate", proseMarkdown: second.proseMarkdown });
    expect(f.acceptance.listApplications(f.project.id, "passage-1")[0]).toMatchObject({
      id: application.id, selectedCandidates: selection,
      previousAcceptedVersions: { "passage-1": null },
    });
    expect(() => f.database.prepare("UPDATE passage_draft_acceptance_items SET passage_id = 'passage-2'").run()).toThrow("immutable");

    const previewWithSecondCurrent = f.acceptance.preview(f.project.id, selection);
    const third = candidate(f, "passage-1", "A newer current candidate");
    expect(f.acceptance.preview(f.project.id, selection).fingerprint).not.toBe(previewWithSecondCurrent.fingerprint);
    expect(f.drafts.getHead(f.project.id, "passage-1")?.current.id).toBe(third.id);
    const otherCandidate = candidate(f, "passage-2", "Other passage candidate");
    const otherAccepted = f.drafts.transition(f.project.id, "passage-2", otherCandidate.id, "accepted");
    expect(() => f.database.prepare(`INSERT INTO passage_draft_acceptance_items (
      application_id, project_id, passage_id, candidate_version_id,
      previous_accepted_version_id, resulting_accepted_version_id, created_at
    ) VALUES (?, ?, 'passage-2', ?, NULL, ?, '2026-08-11T00:00:00.000Z')`)
      .run(application.id, f.project.id, first.id, otherAccepted.id)).toThrow("audit lineage mismatch");
  });

  it("rejects stale, outdated base/upstream, cross-project, and locked replacements", () => {
    const f = fixture();
    const stale = candidate(f, "passage-1", "Stale prose");
    const passageOne = f.passages.currentEntity<Record<string, unknown>>(f.project.id, "passage", "passage-1")!;
    f.passages.saveEntity(f.project.id, "passage", "passage-1", { ...passageOne.content, purpose: "Changed" });
    expect(f.acceptance.preview(f.project.id, [{ passageId: "passage-1", candidateDraftVersionId: stale.id }]).issues.map((item) => item.code))
      .toEqual(expect.arrayContaining(["stale_candidate", "outdated_passage_plan_base"]));

    const upstream = candidate(f, "passage-2", "Upstream old");
    const nextBible = f.artifacts.saveArtifact({
      projectId: f.project.id, artifactId: "bible", content: { proseGuidance: { pointOfView: "first-person" } },
    });
    f.workflow.approve(f.project.id, "bible", nextBible.id);
    expect(f.acceptance.preview(f.project.id, [{ passageId: "passage-2", candidateDraftVersionId: upstream.id }]).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "outdated_upstream_dependency", dependencyId: "bible" })]));
    f.upstreamVersions.bible = nextBible.id;

    const otherProject = f.projects.create("Other", undefined, "long-form");
    expect(f.acceptance.preview(otherProject.id, [{ passageId: "passage-2", candidateDraftVersionId: upstream.id }]).issues[0]?.code)
      .toBe("candidate_not_found");

    const lockedCandidate = candidate(f, "passage-3", "Lock this");
    const accepted = f.drafts.transition(f.project.id, "passage-3", lockedCandidate.id, "accepted");
    const reviewed = f.drafts.transition(f.project.id, "passage-3", accepted.id, "reviewed");
    f.drafts.transition(f.project.id, "passage-3", reviewed.id, "locked");
    const replacement = candidate(f, "passage-3", "Cannot replace yet");
    expect(f.acceptance.preview(f.project.id, [{ passageId: "passage-3", candidateDraftVersionId: replacement.id }]).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "locked_accepted_replacement" })]));
    const lockedHead = f.drafts.getHead(f.project.id, "passage-3")!.accepted!.id;
    f.drafts.unlockAccepted(f.project.id, "passage-3");
    expect(f.drafts.getHead(f.project.id, "passage-3")!.accepted!.id).toBe(lockedHead);
    apply(f, [{ passageId: "passage-3", candidateDraftVersionId: replacement.id }]);
    expect(f.drafts.getHead(f.project.id, "passage-3")!.accepted?.proseMarkdown).toBe("Cannot replace yet");

    const cosmetic = candidate(f, "passage-4", "Cosmetic base remains valid");
    const passageFour = f.passages.currentEntity<Record<string, unknown>>(f.project.id, "passage", "passage-4")!;
    f.passages.saveEntity(f.project.id, "passage", "passage-4", { ...passageFour.content, title: "Cosmetic retitle" });
    expect(f.acceptance.preview(f.project.id, [{ passageId: "passage-4", candidateDraftVersionId: cosmetic.id }]).valid).toBe(true);
  });

  it("propagates exact accepted-neighbor staleness without changing prose or unrelated drafts", () => {
    const f = fixture();
    const b1 = candidate(f, "passage-2", "Neighbor B one");
    const acceptedB1 = f.drafts.transition(f.project.id, "passage-2", b1.id, "accepted");
    const dependentA = candidate(f, "passage-1", "Dependent A prose", { "passage-2": acceptedB1.id });
    const unrelatedC = candidate(f, "passage-3", "Unrelated C prose");
    f.drafts.transition(f.project.id, "passage-2", acceptedB1.id, "reviewed");
    expect(f.drafts.getVersion(f.project.id, dependentA.id)?.stale).toBe(false);
    const b2 = candidate(f, "passage-2", "Neighbor B two replacement");
    const preview = f.acceptance.preview(f.project.id, [{ passageId: "passage-2", candidateDraftVersionId: b2.id }]);
    expect(preview.downstreamStaleness).toEqual(expect.arrayContaining([
      expect.objectContaining({ draftVersionId: dependentA.id, passageId: "passage-1", neighborPassageId: "passage-2", previousAcceptedVersionId: acceptedB1.id }),
    ]));
    apply(f, [{ passageId: "passage-2", candidateDraftVersionId: b2.id }]);
    expect(f.drafts.getVersion(f.project.id, dependentA.id)).toMatchObject({ proseMarkdown: "Dependent A prose", stale: true });
    expect(f.drafts.getVersion(f.project.id, dependentA.id)!.staleReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "accepted-neighbor-draft-change", sourceEntityId: "passage-2", fromVersionId: acceptedB1.id }),
    ]));
    expect(f.drafts.getVersion(f.project.id, unrelatedC.id)?.stale).toBe(false);

    const count = (f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_staleness_events").get() as { count: number }).count;
    const acceptedB2 = f.drafts.getHead(f.project.id, "passage-2")!.accepted!;
    const reviewedB2 = f.drafts.transition(f.project.id, "passage-2", acceptedB2.id, "reviewed");
    f.drafts.transition(f.project.id, "passage-2", reviewedB2.id, "locked");
    expect((f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_staleness_events").get() as { count: number }).count).toBe(count);
    const noOpPreview = f.acceptance.preview(f.project.id, [{ passageId: "passage-2", candidateDraftVersionId: b2.id }]);
    expect(noOpPreview.items[0]?.noOp).toBe(true);
    expect(noOpPreview.valid).toBe(true);
    transaction(f.database, () => f.acceptance.applyInTransaction(noOpPreview));
    expect((f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_staleness_events").get() as { count: number }).count).toBe(count);
  });

  it("propagates accepted replacement staleness through current accepted heads", () => {
    const f = fixture();
    const b1 = candidate(f, "passage-2", "Accepted B one");
    const acceptedB1 = apply(f, [{ passageId: "passage-2", candidateDraftVersionId: b1.id }])
      .resultingAcceptedVersions["passage-2"]!;
    const a = candidate(f, "passage-1", "Accepted A remains byte-identical", { "passage-2": acceptedB1 });
    const acceptedA = apply(f, [{ passageId: "passage-1", candidateDraftVersionId: a.id }])
      .resultingAcceptedVersions["passage-1"]!;
    const c = candidate(f, "passage-3", "Dependent C remains byte-identical", { "passage-1": acceptedA });
    const unrelatedD = candidate(f, "passage-4", "Unrelated D remains current");

    const b2 = candidate(f, "passage-2", "Accepted B replacement");
    apply(f, [{ passageId: "passage-2", candidateDraftVersionId: b2.id }]);

    expect(f.drafts.getHead(f.project.id, "passage-1")?.accepted).toMatchObject({
      id: acceptedA, proseMarkdown: "Accepted A remains byte-identical", stale: true,
    });
    expect(f.drafts.getHead(f.project.id, "passage-1")?.accepted?.staleReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "accepted-neighbor-draft-change", sourceEntityId: "passage-2" }),
    ]));
    expect(f.drafts.getVersion(f.project.id, c.id)).toMatchObject({
      proseMarkdown: "Dependent C remains byte-identical", stale: true,
    });
    expect(f.drafts.getVersion(f.project.id, c.id)?.staleReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "accepted-neighbor-draft-stale", sourceEntityId: "passage-1" }),
    ]));
    expect(f.drafts.getVersion(f.project.id, unrelatedD.id)).toMatchObject({
      proseMarkdown: "Unrelated D remains current", stale: false,
    });
  });

  it("propagates an accepted replacement deterministically through a three-hop chain", () => {
    const f = fixture();
    const b1 = candidate(f, "passage-1", "Chain B one");
    const acceptedB1 = apply(f, [{ passageId: "passage-1", candidateDraftVersionId: b1.id }])
      .resultingAcceptedVersions["passage-1"]!;
    const a = candidate(f, "passage-2", "Chain A prose", { "passage-1": acceptedB1 });
    const acceptedA = apply(f, [{ passageId: "passage-2", candidateDraftVersionId: a.id }])
      .resultingAcceptedVersions["passage-2"]!;
    const c = candidate(f, "passage-3", "Chain C prose", { "passage-2": acceptedA });
    const acceptedC = apply(f, [{ passageId: "passage-3", candidateDraftVersionId: c.id }])
      .resultingAcceptedVersions["passage-3"]!;
    const d = candidate(f, "passage-4", "Chain D prose", { "passage-3": acceptedC });

    const b2 = candidate(f, "passage-1", "Chain B replacement");
    apply(f, [{ passageId: "passage-1", candidateDraftVersionId: b2.id }]);

    expect(f.drafts.getHead(f.project.id, "passage-2")?.accepted).toMatchObject({
      proseMarkdown: "Chain A prose", stale: true,
    });
    expect(f.drafts.getHead(f.project.id, "passage-3")?.accepted).toMatchObject({
      proseMarkdown: "Chain C prose", stale: true,
    });
    expect(f.drafts.getVersion(f.project.id, d.id)).toMatchObject({ proseMarkdown: "Chain D prose", stale: true });
    expect(f.drafts.getVersion(f.project.id, d.id)?.staleReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "accepted-neighbor-draft-stale", sourceEntityId: "passage-3" }),
    ]));
  });

  it("rolls back direct and transitive replacement staleness when acceptance fails afterward", () => {
    const f = fixture();
    const b1 = candidate(f, "passage-1", "Rollback B one");
    const acceptedB1 = apply(f, [{ passageId: "passage-1", candidateDraftVersionId: b1.id }])
      .resultingAcceptedVersions["passage-1"]!;
    const a = candidate(f, "passage-2", "Rollback A prose", { "passage-1": acceptedB1 });
    const acceptedA = apply(f, [{ passageId: "passage-2", candidateDraftVersionId: a.id }])
      .resultingAcceptedVersions["passage-2"]!;
    const c = candidate(f, "passage-3", "Rollback C prose", { "passage-2": acceptedA });
    const b2 = candidate(f, "passage-1", "Rollback B replacement");
    const batchCompanion = candidate(f, "passage-4", "Rollback batch companion");
    const preview = f.acceptance.preview(f.project.id, [
      { passageId: "passage-1", candidateDraftVersionId: b2.id },
      { passageId: "passage-4", candidateDraftVersionId: batchCompanion.id },
    ]);
    const staleCount = (f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_staleness_events").get() as { count: number }).count;
    const applicationCount = (f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_acceptance_applications").get() as { count: number }).count;
    f.database.exec(`CREATE TRIGGER fail_acceptance_audit BEFORE INSERT ON passage_draft_acceptance_applications
      BEGIN SELECT RAISE(ABORT, 'simulated acceptance audit failure'); END`);

    expect(() => transaction(f.database, () => f.acceptance.applyInTransaction(preview)))
      .toThrow("simulated acceptance audit failure");

    expect((f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_staleness_events").get() as { count: number }).count)
      .toBe(staleCount);
    expect((f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_acceptance_applications").get() as { count: number }).count)
      .toBe(applicationCount);
    expect(f.drafts.getHead(f.project.id, "passage-1")?.accepted).toMatchObject({ id: acceptedB1, stale: false });
    expect(f.drafts.getHead(f.project.id, "passage-2")?.accepted).toMatchObject({ id: acceptedA, stale: false });
    expect(f.drafts.getVersion(f.project.id, c.id)).toMatchObject({ proseMarkdown: "Rollback C prose", stale: false });
    expect(f.drafts.getHead(f.project.id, "passage-4")?.accepted).toBeNull();
  });

  it("blocks and propagates stale accepted-neighbor dependencies from passage and upstream changes", () => {
    const f = fixture();
    const b1 = candidate(f, "passage-2", "Accepted neighbor remains immutable");
    const acceptedB1 = apply(f, [{ passageId: "passage-2", candidateDraftVersionId: b1.id }])
      .resultingAcceptedVersions["passage-2"]!;
    const dependentA = candidate(f, "passage-1", "Dependent prose remains byte-identical", { "passage-2": acceptedB1 });
    const unrelatedC = candidate(f, "passage-3", "Unrelated prose");
    const beforeProse = dependentA.proseMarkdown;
    const passageTwo = f.passages.currentEntity<Record<string, unknown>>(f.project.id, "passage", "passage-2")!;
    f.passages.saveEntity(f.project.id, "passage", "passage-2", { ...passageTwo.content, purpose: "Materially changed neighbor" });

    expect(f.drafts.getHead(f.project.id, "passage-2")?.accepted).toMatchObject({ id: acceptedB1, stale: true });
    expect(f.drafts.getVersion(f.project.id, dependentA.id)).toMatchObject({ proseMarkdown: beforeProse, stale: true });
    expect(f.drafts.getVersion(f.project.id, dependentA.id)?.staleReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "accepted-neighbor-draft-stale", sourceEntityId: "passage-2" }),
    ]));
    expect(f.drafts.getVersion(f.project.id, unrelatedC.id)?.stale).toBe(false);
    expect(f.acceptance.preview(f.project.id, [{ passageId: "passage-1", candidateDraftVersionId: dependentA.id }])).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "stale_candidate" }),
        expect.objectContaining({ code: "stale_neighbor_dependency", dependencyId: "passage-2" }),
      ]),
    });
    expect(f.acceptance.preview(f.project.id, [
      { passageId: "passage-1", candidateDraftVersionId: dependentA.id },
      { passageId: "passage-3", candidateDraftVersionId: unrelatedC.id },
    ]).valid).toBe(false);

    const restored = f.drafts.restore(f.project.id, "passage-1", dependentA.id);
    const currentA = f.passages.currentEntity<Record<string, unknown>>(f.project.id, "passage", "passage-1")!;
    const refreshed = f.drafts.refreshStaleness(
      f.project.id, restored.id, currentA.id, currentA.content, f.upstreamVersions,
    );
    expect(refreshed).toMatchObject({ proseMarkdown: beforeProse, stale: true });
    expect(f.acceptance.preview(f.project.id, [{ passageId: "passage-1", candidateDraftVersionId: restored.id }]).valid).toBe(false);

    const f2 = fixture();
    const originalPassageTwo = f2.passages.currentEntity<Record<string, unknown>>(f2.project.id, "passage", "passage-2")!;
    f2.passages.saveEntity(f2.project.id, "passage", "passage-2", {
      ...originalPassageTwo.content, characterIds: ["character-b"],
    });
    const upstreamB = candidate(f2, "passage-2", "Upstream-sensitive accepted neighbor");
    const acceptedUpstreamB = apply(f2, [{ passageId: "passage-2", candidateDraftVersionId: upstreamB.id }])
      .resultingAcceptedVersions["passage-2"]!;
    const upstreamDependent = candidate(f2, "passage-1", "Depends on upstream-sensitive B", {
      "passage-2": acceptedUpstreamB,
    });
    const nextBible = f2.artifacts.saveArtifact({
      projectId: f2.project.id,
      artifactId: "bible",
      content: { characters: [{ id: "character-b", name: "Changed B" }] },
    });
    f2.workflow.approve(f2.project.id, "bible", nextBible.id);
    f2.drafts.markStaleForUpstreamVersion(f2.project.id, "bible", nextBible.id);
    expect(f2.drafts.getHead(f2.project.id, "passage-2")?.accepted?.stale).toBe(true);
    expect(f2.drafts.getVersion(f2.project.id, upstreamDependent.id)).toMatchObject({
      proseMarkdown: "Depends on upstream-sensitive B", stale: true,
    });
    expect(f2.acceptance.preview(f2.project.id, [{
      passageId: "passage-1", candidateDraftVersionId: upstreamDependent.id,
    }]).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "stale_neighbor_dependency", dependencyId: "passage-2" }),
    ]));
  });

  it("accepts independent batches atomically and rejects duplicates and post-batch neighbor incompatibility", () => {
    const f = fixture();
    const one = candidate(f, "passage-1", "One independent");
    const two = candidate(f, "passage-2", "Two independent");
    const three = candidate(f, "passage-3", "Three independent");
    apply(f, [one, two, three].map((item) => ({ passageId: item.passageId, candidateDraftVersionId: item.id })));
    expect(["passage-1", "passage-2", "passage-3"].map((id) => f.drafts.getHead(f.project.id, id)?.accepted?.proseMarkdown))
      .toEqual(["One independent", "Two independent", "Three independent"]);

    const duplicate = candidate(f, "passage-4", "Duplicate");
    expect(f.acceptance.preview(f.project.id, [
      { passageId: "passage-4", candidateDraftVersionId: duplicate.id },
      { passageId: "passage-4", candidateDraftVersionId: duplicate.id },
    ])).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.objectContaining({ code: "duplicate_passage" })]) });

    const replacementB = candidate(f, "passage-2", "Replacement B");
    const dependsOnOldB = candidate(f, "passage-4", "Depends on old B", {
      "passage-2": f.drafts.getHead(f.project.id, "passage-2")!.accepted!.id,
    });
    const incompatible = f.acceptance.preview(f.project.id, [
      { passageId: "passage-4", candidateDraftVersionId: dependsOnOldB.id },
      { passageId: "passage-2", candidateDraftVersionId: replacementB.id },
    ]);
    expect(incompatible).toMatchObject({ valid: false, issues: expect.arrayContaining([
      expect.objectContaining({ code: "outdated_neighbor_dependency", passageId: "passage-4" }),
    ]) });
  });

  it("rolls back every lifecycle, head, audit, and staleness write when the second batch insert fails", () => {
    const f = fixture();
    const one = candidate(f, "passage-1", "First should roll back");
    const two = candidate(f, "passage-2", "Second fails");
    const selections = [one, two].map((item) => ({ passageId: item.passageId, candidateDraftVersionId: item.id }));
    const preview = f.acceptance.preview(f.project.id, selections);
    const versionCount = (f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_versions").get() as { count: number }).count;
    f.database.exec(`CREATE TRIGGER fail_second_accept BEFORE INSERT ON passage_draft_versions
      WHEN NEW.passage_id = 'passage-2' AND NEW.lifecycle_status = 'accepted'
      BEGIN SELECT RAISE(ABORT, 'simulated second acceptance failure'); END`);
    expect(() => transaction(f.database, () => f.acceptance.applyInTransaction(preview))).toThrow("simulated second");
    expect((f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_versions").get() as { count: number }).count).toBe(versionCount);
    expect((f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_acceptance_applications").get() as { count: number }).count).toBe(0);
    expect(f.drafts.getHead(f.project.id, "passage-1")?.accepted).toBeNull();
    expect(f.drafts.getHead(f.project.id, "passage-2")?.accepted).toBeNull();
  });

  it("detects stale previews and reports exact mixed lifecycle corpus totals without double-counting", () => {
    const f = fixture();
    const one = candidate(f, "passage-1", "one two three");
    const preview = f.acceptance.preview(f.project.id, [{ passageId: "passage-1", candidateDraftVersionId: one.id }]);
    const competing = candidate(f, "passage-1", "competing accepted words");
    apply(f, [{ passageId: "passage-1", candidateDraftVersionId: competing.id }]);
    expect(f.acceptance.preview(f.project.id, preview.selections).fingerprint).not.toBe(preview.fingerprint);

    const two = candidate(f, "passage-2", "four five");
    const acceptedTwo = f.drafts.transition(f.project.id, "passage-2", two.id, "accepted");
    const reviewedTwo = f.drafts.transition(f.project.id, "passage-2", acceptedTwo.id, "reviewed");
    f.drafts.transition(f.project.id, "passage-2", reviewedTwo.id, "locked");
    candidate(f, "passage-3", "candidate only words");
    const summary = f.drafts.projectSummary(f.project.id);
    expect(summary).toMatchObject({
      passageCount: 4, currentCandidateCount: 1, acceptedDraftCount: 2,
      reviewedDraftCount: 1, lockedDraftCount: 1, acceptedWords: 5,
      reviewedWords: 2, lockedWords: 2, candidateWords: 3, plannedWords: 400, remainingWords: 395,
      acceptanceCompletionPercentage: 1.25,
    });
    expect(f.drafts.listReviewQueue(f.project.id)).toHaveLength(4);
    expect(f.drafts.listReviewQueue(f.project.id)[0]).not.toHaveProperty("proseMarkdown");
    for (const passageId of ["passage-1", "passage-3"]) {
      const current = f.passages.currentEntity<Record<string, unknown>>(f.project.id, "passage", passageId)!;
      f.passages.saveEntity(f.project.id, "passage", passageId, { ...current.content, purpose: `Stale ${passageId}` });
    }
    expect(f.drafts.projectSummary(f.project.id)).toMatchObject({
      staleCurrentCandidateCount: 1, staleAcceptedDraftCount: 1, staleAcceptedWords: 3,
      acceptedWords: 5, remainingWords: 395,
    });
  });

  it("preserves project deletion cascades for acceptance audit records", () => {
    const f = fixture();
    const draft = candidate(f, "passage-1", "Cascade audit");
    apply(f, [{ passageId: "passage-1", candidateDraftVersionId: draft.id }]);
    expect(() => f.database.prepare("DELETE FROM projects WHERE id = ?").run(f.project.id)).not.toThrow();
    expect((f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_acceptance_applications").get() as { count: number }).count).toBe(0);
    expect((f.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_acceptance_items").get() as { count: number }).count).toBe(0);
  });
});
