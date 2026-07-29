import { describe, expect, it } from "vitest";
import { openDatabase, PassagePlanRepository, ProjectRepository } from "../src/index.js";

const structure = {
  schemaVersion: 1,
  title: "Large passage plan",
  projectWordTarget: 150_000,
  typicalPathWordTarget: 75_000,
  startPassageId: "passage-000",
  acts: [
    {
      id: "act-1",
      label: "Act One",
      purpose: "",
      summary: "",
      wordTarget: 150_000,
      routeIds: ["route-1"],
      sequenceIds: ["sequence-1"],
      position: 0,
    },
  ],
  sequences: [
    {
      id: "sequence-1",
      actId: "act-1",
      label: "Main sequence",
      purpose: "",
      summary: "",
      wordTarget: 150_000,
      routeIds: ["route-1"],
      passageIds: Array.from({ length: 300 }, (_, index) => `passage-${String(index).padStart(3, "0")}`),
      entryGoals: [],
      exitGoals: [],
      requiredDecisionIds: [],
      endingHookIds: [],
      position: 0,
      planningStatus: "planned",
    },
  ],
  characterAvailability: [],
};

const passages = Array.from({ length: 300 }, (_, index) => {
  const passageId = `passage-${String(index).padStart(3, "0")}`;
  return {
    kind: "passage" as const,
    id: passageId,
    content: { id: passageId, title: `Passage ${index}`, position: index, wordTarget: 500 },
  };
});

describe("PassagePlanRepository", () => {
  it("persists, versions, snapshots, restores, and reorders 300 stable-ID entities", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const repository = new PassagePlanRepository(database);
    const project = projects.create("Large plan", undefined, "long-form");

    repository.initialize(project.id, structure, passages);
    expect(repository.currentEntities(project.id, "passage")).toHaveLength(300);
    expect(repository.currentStructure<typeof structure>(project.id)?.content).toEqual(structure);

    const reversedIds = [...structure.sequences[0]!.passageIds].reverse();
    const reordered = {
      ...structure,
      sequences: [{ ...structure.sequences[0]!, passageIds: reversedIds }],
    };
    repository.saveBundle(project.id, reordered, passages, {
      passage: new Set(passages.map((item) => item.id)),
      choice: new Set(),
      thread: new Set(),
    });

    expect(repository.listStructureVersions(project.id)).toHaveLength(2);
    expect(repository.currentStructure<typeof structure>(project.id)?.content.sequences[0]?.passageIds).toEqual(reversedIds);
    expect(repository.listEntityVersions(project.id, "passage", "passage-000")).toHaveLength(1);

    const changed = { ...passages[0]!, content: { ...passages[0]!.content, title: "Changed title" } };
    repository.saveBundle(project.id, reordered, [changed, ...passages.slice(1)], {
      passage: new Set(passages.map((item) => item.id)),
      choice: new Set(),
      thread: new Set(),
    });
    expect(repository.listEntityVersions(project.id, "passage", "passage-000")).toHaveLength(2);
    expect(repository.listEntityVersions(project.id, "passage", "passage-001")).toHaveLength(1);

    const snapshot = repository.createSnapshot(project.id, { brief: "brief-v1" }, { findings: [] });
    repository.tombstone(project.id, "passage", "passage-000");
    expect(repository.currentEntities(project.id, "passage")).toHaveLength(299);
    repository.restoreSnapshot(project.id, snapshot.id);
    expect(repository.currentEntities(project.id, "passage")).toHaveLength(300);
    expect(repository.currentEntities<{ title: string }>(project.id, "passage")
      .find((item) => item.entityId === "passage-000")?.content.title).toBe("Changed title");

    repository.tombstone(project.id, "passage", "passage-000");
    repository.saveBundle(project.id, reordered, [changed, ...passages.slice(1)], {
      passage: new Set(passages.map((item) => item.id)),
      choice: new Set(),
      thread: new Set(),
    });
    expect(repository.currentEntities(project.id, "passage")).toHaveLength(300);
    database.close();
  });
});
