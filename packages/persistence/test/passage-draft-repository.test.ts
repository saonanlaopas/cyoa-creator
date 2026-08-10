import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ArtifactRepository,
  countDraftWords,
  openDatabase,
  PassageDraftRepository,
  PassagePlanRepository,
  ProjectRepository,
  WorkflowRepository,
  type StoryDatabase,
} from "../src/index.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

const passage = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  sequenceId: "sequence-1",
  title: `Title ${id}`,
  kind: "scene",
  purpose: "Establish the problem",
  summary: "A concise summary",
  wordTarget: 500,
  routeIds: [],
  tags: [],
  characterIds: ["character-1"],
  relationshipIds: [],
  locationIds: [],
  requiredFactIds: ["fact-1"],
  revealedFactIds: [],
  setupThreadIds: [],
  payoffThreadIds: [],
  preservedDifferenceIds: [],
  choiceIds: ["choice-1"],
  terminal: false,
  endingId: null,
  draftingNotes: [],
  unresolvedQuestions: [],
  planningStatus: "planned",
  position: id === "passage-1" ? 0 : 1,
  ...overrides,
});
const choice = (overrides: Record<string, unknown> = {}) => ({
  id: "choice-1",
  sourcePassageId: "passage-1",
  destinationPassageId: "passage-2",
  label: "Continue",
  narrativeIntent: "Move forward",
  consequencePreview: "",
  condition: null,
  unavailableBehavior: "disabled",
  unavailableExplanation: "",
  effects: [],
  sourceDecisionIds: [],
  position: 0,
  ...overrides,
});

function setup(path = ":memory:") {
  const database = openDatabase(path);
  const projects = new ProjectRepository(database);
  const artifacts = new ArtifactRepository(database);
  const workflow = new WorkflowRepository(database);
  const drafts = new PassageDraftRepository(database);
  const passages = new PassagePlanRepository(
    database,
    (mutation) => drafts.handlePassagePlanMutationInTransaction(mutation),
  );
  const project = projects.create("Draft fixture", undefined, "long-form");
  const upstreamVersions = Object.fromEntries(["brief", "bible", "routes", "endings", "mechanics"].map((artifactId) => {
    const version = artifacts.saveArtifact({ projectId: project.id, artifactId, content: { artifactId } });
    workflow.approve(project.id, artifactId, version.id);
    return [artifactId, version.id];
  }));
  passages.initialize(project.id, {
    schemaVersion: 1, title: "Plan", projectWordTarget: 1000, typicalPathWordTarget: 1000,
    startPassageId: "passage-1", acts: [], sequences: [], characterAvailability: [],
  }, [
    { kind: "passage", id: "passage-1", content: passage("passage-1") },
    { kind: "passage", id: "passage-2", content: passage("passage-2", { terminal: true, choiceIds: [] }) },
    { kind: "choice", id: "choice-1", content: choice() },
  ]);
  return { database, projects, artifacts, workflow, drafts, passages, project, upstreamVersions };
}

function createDraft(
  fixture: ReturnType<typeof setup>,
  proseMarkdown = "First draft words",
  passageId = "passage-1",
) {
  const base = fixture.passages.currentEntity(fixture.project.id, "passage", passageId)!;
  return fixture.drafts.createVersion({
    projectId: fixture.project.id,
    passageId,
    basedOnPassagePlanVersionId: base.id,
    proseMarkdown,
    sourceKind: "manual",
    authorNote: "Manual note",
    upstreamVersions: fixture.upstreamVersions,
  });
}

describe("passage draft repository", () => {
  it("creates immutable per-passage versions with exact provenance and deterministic Unicode word counts", () => {
    const fixture = setup();
    const first = createDraft(fixture, "“Fanawë Eterúna” walks—quietly. 東京");
    const second = createDraft(fixture, "A later immutable version");
    expect(first).toMatchObject({
      version: 1,
      wordCount: 4,
      status: "candidate",
      sourceKind: "manual",
      upstreamVersions: fixture.upstreamVersions,
    });
    expect(second).toMatchObject({ version: 2, wordCount: 4, basedOnPassagePlanVersionId: first.basedOnPassagePlanVersionId });
    expect(fixture.drafts.listVersions(fixture.project.id, "passage-1").map((item) => item.id)).toEqual([second.id, first.id]);
    expect(fixture.drafts.getVersion(fixture.project.id, first.id)?.proseMarkdown).toContain("Fanawë Eterúna");
    expect(countDraftWords("one two-three l’esprit 東京")).toBe(4);
    expect(() => fixture.database.prepare("UPDATE passage_draft_versions SET prose_markdown = 'changed' WHERE id = ?").run(first.id))
      .toThrow("immutable");
    fixture.database.close();
  });

  it("rejects wrong-passage and cross-project passage-plan version linkage", () => {
    const fixture = setup();
    const wrongPassageVersion = fixture.passages.currentEntity(fixture.project.id, "passage", "passage-2")!;
    expect(() => fixture.drafts.createVersion({
      projectId: fixture.project.id, passageId: "passage-1",
      basedOnPassagePlanVersionId: wrongPassageVersion.id, proseMarkdown: "Wrong",
      sourceKind: "manual", upstreamVersions: fixture.upstreamVersions,
    })).toThrow("lineage mismatch");

    const other = fixture.projects.create("Other", undefined, "long-form");
    const otherPassages = new PassagePlanRepository(fixture.database);
    otherPassages.initialize(other.id, { schemaVersion: 1 }, [
      { kind: "passage", id: "passage-1", content: passage("passage-1") },
    ]);
    const crossProjectVersion = otherPassages.currentEntity(other.id, "passage", "passage-1")!;
    expect(() => fixture.drafts.createVersion({
      projectId: fixture.project.id, passageId: "passage-1",
      basedOnPassagePlanVersionId: crossProjectVersion.id, proseMarkdown: "Cross project",
      sourceKind: "manual", upstreamVersions: fixture.upstreamVersions,
    })).toThrow("lineage mismatch");
    expect(fixture.drafts.listVersions(fixture.project.id, "passage-1")).toEqual([]);
    fixture.database.close();
  });

  it("survives reopen and restores history as a new candidate without overwriting the source", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-draft-history-"));
    directories.push(directory);
    const path = join(directory, "story.sqlite");
    const first = setup(path);
    const source = createDraft(first, "Persistent original");
    first.database.close();

    const reopenedDatabase = openDatabase(path);
    const reopenedDrafts = new PassageDraftRepository(reopenedDatabase);
    expect(reopenedDrafts.getHead(first.project.id, "passage-1")?.current.id).toBe(source.id);
    const restored = reopenedDrafts.restore(first.project.id, "passage-1", source.id);
    expect(restored).toMatchObject({ version: 2, proseMarkdown: "Persistent original", restoredFromVersionId: source.id, status: "candidate" });
    expect(reopenedDrafts.listVersions(first.project.id, "passage-1")).toHaveLength(2);
    reopenedDatabase.close();
  });

  it("enforces candidate, accepted, reviewed, locked, and stale lifecycle semantics centrally", () => {
    const fixture = setup();
    const candidate = createDraft(fixture);
    expect(() => fixture.drafts.transition(fixture.project.id, "passage-1", candidate.id, "reviewed"))
      .toThrow("Invalid passage draft transition");
    const accepted = fixture.drafts.transition(fixture.project.id, "passage-1", candidate.id, "accepted");
    const reviewed = fixture.drafts.transition(fixture.project.id, "passage-1", accepted.id, "reviewed");
    const locked = fixture.drafts.transition(fixture.project.id, "passage-1", reviewed.id, "locked");
    expect([candidate.lifecycleStatus, accepted.lifecycleStatus, reviewed.lifecycleStatus, locked.lifecycleStatus])
      .toEqual(["candidate", "accepted", "reviewed", "locked"]);
    expect(fixture.drafts.getHead(fixture.project.id, "passage-1")).toMatchObject({
      accepted: { id: locked.id, lifecycleStatus: "locked" }, acceptedLocked: true,
    });
    const newCandidate = createDraft(fixture, "A candidate beside locked accepted prose");
    expect(fixture.drafts.getHead(fixture.project.id, "passage-1")).toMatchObject({
      current: { id: newCandidate.id }, accepted: { id: locked.id }, acceptedLocked: true,
    });
    expect(() => fixture.drafts.transition(fixture.project.id, "passage-1", newCandidate.id, "accepted"))
      .toThrow("Locked accepted prose");
    fixture.database.close();
  });

  const materialChanges: Array<[string, Record<string, unknown>]> = [
    ["purpose", { purpose: "A materially different purpose" }],
    ["requiredFactIds", { requiredFactIds: ["fact-2"] }],
    ["characterIds", { characterIds: ["character-2"] }],
    ["choiceIds", { choiceIds: ["choice-new"] }],
    ["terminal/ending", { terminal: true, endingId: "ending-1", choiceIds: [] }],
    ["wordTarget", { wordTarget: 900 }],
  ];
  for (const [label, change] of materialChanges) {
    it(`marks a draft stale for material ${label} changes`, () => {
      const fixture = setup();
      const draft = createDraft(fixture);
      const current = fixture.passages.currentEntity<Record<string, unknown>>(fixture.project.id, "passage", "passage-1")!;
      fixture.passages.saveEntity(fixture.project.id, "passage", "passage-1", { ...current.content, ...change });
      const stale = fixture.drafts.getVersion(fixture.project.id, draft.id)!;
      expect(stale.status).toBe("stale");
      expect(stale.staleReasons[0]).toMatchObject({ reasonCode: "passage-plan-material-change", sourceEntityId: "passage-1" });
      expect(stale.staleReasons[0]!.changedFields.length).toBeGreaterThan(0);
      fixture.database.close();
    });
  }

  it("does not stale for documented cosmetic or unrelated-passage changes", () => {
    const fixture = setup();
    const draft = createDraft(fixture);
    const current = fixture.passages.currentEntity<Record<string, unknown>>(fixture.project.id, "passage", "passage-1")!;
    fixture.passages.saveEntity(fixture.project.id, "passage", "passage-1", {
      ...current.content, title: "Cosmetic retitle", tags: ["ui-only"], planningStatus: "reviewed", position: 99,
    });
    const unrelated = fixture.passages.currentEntity<Record<string, unknown>>(fixture.project.id, "passage", "passage-2")!;
    fixture.passages.saveEntity(fixture.project.id, "passage", "passage-2", { ...unrelated.content, purpose: "Other purpose" });
    expect(fixture.drafts.getVersion(fixture.project.id, draft.id)?.stale).toBe(false);
    fixture.database.close();
  });

  it("uses the same mutation observer for choice changes, proposal-style writes, and restores", () => {
    const fixture = setup();
    const first = createDraft(fixture);
    const existingChoice = fixture.passages.currentEntity<Record<string, unknown>>(fixture.project.id, "choice", "choice-1")!;
    fixture.passages.saveEntity(fixture.project.id, "choice", "choice-1", { ...existingChoice.content, destinationPassageId: "passage-1" });
    expect(fixture.drafts.getVersion(fixture.project.id, first.id)?.staleReasons[0]).toMatchObject({ reasonCode: "choice-plan-change" });

    const currentPassage = fixture.passages.currentEntity<Record<string, unknown>>(fixture.project.id, "passage", "passage-1")!;
    const second = createDraft(fixture, "Current after choice change");
    const proposalStyle = fixture.passages.insertEntityVersionInTransaction(
      fixture.project.id, "passage", "passage-1", { ...currentPassage.content, requiredFactIds: ["proposal-fact"] },
    );
    expect(fixture.drafts.getVersion(fixture.project.id, second.id)?.stale).toBe(true);
    const third = createDraft(fixture, "Current after proposal write");
    fixture.passages.restoreEntity(fixture.project.id, "passage", "passage-1", currentPassage.id);
    const restoredStale = fixture.drafts.getVersion(fixture.project.id, third.id)!;
    expect(restoredStale.stale).toBe(true);
    expect(restoredStale.staleReasons.some((reason) => reason.toVersionId !== proposalStyle.id)).toBe(true);
    fixture.database.close();
  });

  it("stales source and destination drafts for material choice changes without touching unrelated passages", () => {
    const fixture = setup();
    fixture.passages.saveEntity(fixture.project.id, "passage", "passage-3", passage("passage-3"));
    const source = createDraft(fixture, "Source prose", "passage-1");
    const destination = createDraft(fixture, "Destination prose", "passage-2");
    const unrelated = createDraft(fixture, "Unrelated prose", "passage-3");
    const current = fixture.passages.currentEntity<Record<string, unknown>>(
      fixture.project.id, "choice", "choice-1",
    )!;
    fixture.passages.saveEntity(fixture.project.id, "choice", "choice-1", {
      ...current.content,
      effects: [{ id: "effect-1", mechanicKey: "resolve", operation: "add", value: 1 }],
    });
    expect(fixture.drafts.getVersion(fixture.project.id, source.id)?.stale).toBe(true);
    expect(fixture.drafts.getVersion(fixture.project.id, destination.id)?.stale).toBe(true);
    expect(fixture.drafts.getVersion(fixture.project.id, unrelated.id)?.stale).toBe(false);
    fixture.database.close();
  });

  it("stales the source, old destination, and new destination when a choice destination changes", () => {
    const fixture = setup();
    fixture.passages.saveEntity(fixture.project.id, "passage", "passage-3", passage("passage-3"));
    const drafts = ["passage-1", "passage-2", "passage-3"]
      .map((passageId) => createDraft(fixture, `Prose for ${passageId}`, passageId));
    const current = fixture.passages.currentEntity<Record<string, unknown>>(
      fixture.project.id, "choice", "choice-1",
    )!;
    fixture.passages.saveEntity(fixture.project.id, "choice", "choice-1", {
      ...current.content,
      destinationPassageId: "passage-3",
    });
    expect(drafts.map((draft) => fixture.drafts.getVersion(fixture.project.id, draft.id)?.stale))
      .toEqual([true, true, true]);
    fixture.database.close();
  });

  it("does not stale any passage when a choice is saved without a material change", () => {
    const fixture = setup();
    const source = createDraft(fixture, "Source prose", "passage-1");
    const destination = createDraft(fixture, "Destination prose", "passage-2");
    const current = fixture.passages.currentEntity<Record<string, unknown>>(
      fixture.project.id, "choice", "choice-1",
    )!;
    fixture.passages.saveEntity(fixture.project.id, "choice", "choice-1", { ...current.content });
    expect(fixture.drafts.getVersion(fixture.project.id, source.id)?.stale).toBe(false);
    expect(fixture.drafts.getVersion(fixture.project.id, destination.id)?.stale).toBe(false);
    fixture.database.close();
  });

  it("observes snapshot restores from exact prior state and ignores materially identical restores", () => {
    const fixture = setup();
    const snapshot = fixture.passages.createSnapshot(fixture.project.id, fixture.upstreamVersions, { findings: [] });
    const draft = createDraft(fixture);
    const before = fixture.passages.currentEntity(fixture.project.id, "passage", "passage-1")!;
    fixture.passages.restoreSnapshot(fixture.project.id, snapshot.id);
    const after = fixture.passages.currentEntity(fixture.project.id, "passage", "passage-1")!;
    expect(after.id).not.toBe(before.id);
    expect(after.restoredFromVersionId).toBe(before.id);
    expect(fixture.drafts.getVersion(fixture.project.id, draft.id)?.stale).toBe(false);

    const changed = fixture.passages.saveEntity(fixture.project.id, "passage", "passage-1", {
      ...record(after.content), purpose: "Materially changed after snapshot",
    });
    const changedDraft = createDraft(fixture, "Draft against changed passage");
    fixture.passages.restoreSnapshot(fixture.project.id, snapshot.id);
    const stale = fixture.drafts.getVersion(fixture.project.id, changedDraft.id)!;
    expect(stale.staleReasons[0]).toMatchObject({
      sourceEntityKind: "passage", sourceEntityId: "passage-1", fromVersionId: changed.id,
    });
    expect(stale.staleReasons[0]?.toVersionId).toBe(
      fixture.passages.currentEntity(fixture.project.id, "passage", "passage-1")?.id,
    );
    fixture.database.close();
  });

  it("observes removed passages and changed or removed choices through snapshot restore", () => {
    const fixture = setup();
    const originalPassage = fixture.passages.currentEntity(fixture.project.id, "passage", "passage-1")!;
    const originalChoice = fixture.passages.currentEntity(fixture.project.id, "choice", "choice-1")!;
    fixture.passages.tombstone(fixture.project.id, "passage", "passage-1");
    fixture.passages.tombstone(fixture.project.id, "choice", "choice-1");
    const removalSnapshot = fixture.passages.createSnapshot(
      fixture.project.id, fixture.upstreamVersions, { findings: [] },
    );
    fixture.passages.restoreEntity(fixture.project.id, "passage", "passage-1", originalPassage.id);
    fixture.passages.restoreEntity(fixture.project.id, "choice", "choice-1", originalChoice.id);
    const source = createDraft(fixture, "Retained source draft", "passage-1");
    const destination = createDraft(fixture, "Retained destination draft", "passage-2");
    fixture.passages.restoreSnapshot(fixture.project.id, removalSnapshot.id);
    expect(fixture.drafts.getVersion(fixture.project.id, source.id)?.staleReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "passage-plan-material-change", changedFields: ["removed"] }),
      expect.objectContaining({ reasonCode: "choice-plan-change", sourceEntityId: "choice-1" }),
    ]));
    expect(fixture.drafts.getVersion(fixture.project.id, destination.id)?.staleReasons[0])
      .toMatchObject({ reasonCode: "choice-plan-change", sourceEntityId: "choice-1" });
    fixture.database.close();
  });

  it("routes materially changed snapshot choices through the centralized choice classifier", () => {
    const fixture = setup();
    const snapshot = fixture.passages.createSnapshot(fixture.project.id, fixture.upstreamVersions, { findings: [] });
    const original = fixture.passages.currentEntity<Record<string, unknown>>(
      fixture.project.id, "choice", "choice-1",
    )!;
    const changed = fixture.passages.saveEntity(fixture.project.id, "choice", "choice-1", {
      ...original.content,
      condition: { kind: "compare", mechanicKey: "door_open", operator: "eq", value: true },
    });
    const source = createDraft(fixture, "Source after changed choice", "passage-1");
    const destination = createDraft(fixture, "Destination after changed choice", "passage-2");
    fixture.passages.restoreSnapshot(fixture.project.id, snapshot.id);
    for (const draft of [source, destination]) {
      expect(fixture.drafts.getVersion(fixture.project.id, draft.id)?.staleReasons[0]).toMatchObject({
        reasonCode: "choice-plan-change",
        sourceEntityId: "choice-1",
        fromVersionId: changed.id,
      });
    }
    fixture.database.close();
  });

  it("rolls back every snapshot restore write when mutation observation fails", () => {
    const fixture = setup();
    const snapshot = fixture.passages.createSnapshot(fixture.project.id, fixture.upstreamVersions, { findings: [] });
    const current = fixture.passages.currentEntity<Record<string, unknown>>(
      fixture.project.id, "passage", "passage-1",
    )!;
    fixture.passages.saveEntity(fixture.project.id, "passage", "passage-1", {
      ...current.content, purpose: "Current material purpose",
    });
    const draft = createDraft(fixture, "Must remain current after rollback");
    const beforeHead = fixture.passages.currentEntity(fixture.project.id, "passage", "passage-1")!;
    const beforeVersions = fixture.passages.listAllEntityVersions(fixture.project.id).length;
    const failing = new PassagePlanRepository(fixture.database, (mutation) => {
      fixture.drafts.handlePassagePlanMutationInTransaction(mutation);
      throw new Error("Simulated restore observer failure");
    });
    expect(() => failing.restoreSnapshot(fixture.project.id, snapshot.id)).toThrow("observer failure");
    expect(fixture.passages.currentEntity(fixture.project.id, "passage", "passage-1")?.id).toBe(beforeHead.id);
    expect(fixture.passages.listAllEntityVersions(fixture.project.id)).toHaveLength(beforeVersions);
    expect(fixture.drafts.getVersion(fixture.project.id, draft.id)?.stale).toBe(false);
    fixture.database.close();
  });

  it("stales only drafts with relevant upstream changes and preserves exact event provenance", () => {
    const fixture = setup();
    const relevant = createDraft(fixture, "Keep this prose readable");
    const nextBible = fixture.artifacts.saveArtifact({
      projectId: fixture.project.id,
      artifactId: "bible",
      content: { artifactId: "bible", characters: [{ id: "character-1", summary: "Changed" }] },
    });
    expect(fixture.drafts.markStaleForUpstreamVersion(fixture.project.id, "bible", nextBible.id)).toBe(1);
    const stale = fixture.drafts.getVersion(fixture.project.id, relevant.id)!;
    expect(stale).toMatchObject({ stale: true, proseMarkdown: "Keep this prose readable" });
    expect(stale.staleReasons[0]).toMatchObject({
      reasonCode: "approved-upstream-version-change",
      sourceEntityId: "bible",
      fromVersionId: fixture.upstreamVersions.bible,
      toVersionId: nextBible.id,
    });
    fixture.database.close();
  });

  it("does not stale a draft for an unrelated stable-ID upstream entity change", () => {
    const fixture = setup();
    const draft = createDraft(fixture);
    const nextBible = fixture.artifacts.saveArtifact({
      projectId: fixture.project.id,
      artifactId: "bible",
      content: { artifactId: "bible", characters: [{ id: "character-unrelated", summary: "Changed" }] },
    });
    expect(fixture.drafts.markStaleForUpstreamVersion(fixture.project.id, "bible", nextBible.id)).toBe(0);
    const currentPassage = fixture.passages.currentEntity(
      fixture.project.id, "passage", "passage-1",
    )!;
    fixture.drafts.refreshStaleness(
      fixture.project.id,
      draft.id,
      currentPassage.id,
      currentPassage.content,
      { ...fixture.upstreamVersions, bible: nextBible.id },
    );
    expect(fixture.drafts.getVersion(fixture.project.id, draft.id)?.stale).toBe(false);
    fixture.database.close();
  });

  it("treats changed Bible prose guidance as genuinely project-wide", () => {
    const fixture = setup();
    const first = createDraft(fixture, "First prose", "passage-1");
    const second = createDraft(fixture, "Second prose", "passage-2");
    const nextBible = fixture.artifacts.saveArtifact({
      projectId: fixture.project.id,
      artifactId: "bible",
      content: { artifactId: "bible", proseGuidance: { pointOfView: "first-person" } },
    });
    expect(fixture.drafts.markStaleForUpstreamVersion(fixture.project.id, "bible", nextBible.id)).toBe(2);
    expect([first, second].map((draft) => fixture.drafts.getVersion(fixture.project.id, draft.id)?.stale))
      .toEqual([true, true]);
    expect(fixture.drafts.getVersion(fixture.project.id, first.id)?.proseMarkdown).toBe("First prose");
    expect(fixture.drafts.listVersions(fixture.project.id, "passage-1")).toHaveLength(1);
    fixture.database.close();
  });

  it("uses mechanic keys on reachable choices to scope mechanics-plan staleness", () => {
    const fixture = setup();
    fixture.passages.saveEntity(fixture.project.id, "passage", "passage-3", passage("passage-3"));
    const currentChoice = fixture.passages.currentEntity<Record<string, unknown>>(
      fixture.project.id, "choice", "choice-1",
    )!;
    fixture.passages.saveEntity(fixture.project.id, "choice", "choice-1", {
      ...currentChoice.content,
      effects: [{ id: "effect-resolve", mechanicKey: "resolve", operation: "add", value: 1 }],
    });
    const source = createDraft(fixture, "Source", "passage-1");
    const destination = createDraft(fixture, "Destination", "passage-2");
    const unrelated = createDraft(fixture, "Unrelated", "passage-3");
    const nextMechanics = fixture.artifacts.saveArtifact({
      projectId: fixture.project.id,
      artifactId: "mechanics",
      content: {
        artifactId: "mechanics",
        visibleStats: [{ id: "stat-resolve", key: "resolve", description: "Changed definition" }],
      },
    });
    expect(fixture.drafts.markStaleForUpstreamVersion(
      fixture.project.id, "mechanics", nextMechanics.id,
    )).toBe(2);
    expect(fixture.drafts.getVersion(fixture.project.id, source.id)?.stale).toBe(true);
    expect(fixture.drafts.getVersion(fixture.project.id, destination.id)?.stale).toBe(true);
    expect(fixture.drafts.getVersion(fixture.project.id, unrelated.id)?.stale).toBe(false);
    fixture.database.close();
  });

  it("derives project word-count reporting without loading prose into passage list rows", () => {
    const fixture = setup();
    const candidate = createDraft(fixture, "one two three four");
    fixture.drafts.transition(fixture.project.id, "passage-1", candidate.id, "accepted");
    expect(fixture.drafts.projectSummary(fixture.project.id)).toMatchObject({
      passageCount: 2,
      currentDraftCount: 1,
      acceptedDraftCount: 1,
      currentCandidateWords: 4,
      acceptedWords: 4,
      plannedWords: 1000,
      remainingWords: 996,
    });
    fixture.database.close();
  });
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
