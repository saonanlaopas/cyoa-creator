import { describe, expect, it } from "vitest";
import type { Project } from "@story-to-cyoa/domain";
import { ArtifactRepository, openDatabase, ProjectRepository } from "@story-to-cyoa/persistence";
import { proposeNarrativeRepair, reviewNarrative } from "../src/index.js";

describe("narrative review", () => {
  it("validates cited advisory findings and versions them separately", async () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const projectRecord = projects.create("Review");
    const project = {
      id: projectRecord.id, name: "Review", schemaVersion: 1, startPassageId: "start", metadata: {},
      mechanics: { visibleStats: {}, relationships: {}, hiddenFlags: {}, inventory: [], protagonistTendencies: [], divergenceMode: "balanced", randomness: false },
      passages: [{ id: "start", title: "Start", purpose: "", prose: "Mara knew.", participants: [], requiredKnowledge: [], incomingAssumptions: [], ending: "success", choices: [] }],
    } as Project;
    const finding = {
      id: "finding-1", kind: "false_knowledge", severity: "warning",
      message: "Mara knows too much.", passageIds: ["start"], sourceExcerptIds: ["ex_1"],
      suggestion: "Delay the reveal.",
    } as const;
    const version = await reviewNarrative({
      projectId: projectRecord.id, project, storyBible: { facts: [{ excerptId: "ex_1" }] },
      generator: { generate: async () => ({ schemaVersion: 1, findings: [finding] }) },
      artifacts,
    });
    expect(version).toMatchObject({ artifactId: "review", content: { findings: [finding] } });
    expect(proposeNarrativeRepair(finding)).toMatchObject({ approvalRequired: true, status: "proposed" });
    database.close();
  });

  it("rejects findings without both source and passage citations", async () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const record = projects.create("Invalid review");
    await expect(reviewNarrative({
      projectId: record.id,
      project: { id: record.id, name: "Invalid review", schemaVersion: 1, startPassageId: "x", passages: [], mechanics: { visibleStats: {}, relationships: {}, hiddenFlags: {}, inventory: [], protagonistTendencies: [], divergenceMode: "balanced", randomness: false }, metadata: {} } as Project,
      storyBible: {},
      generator: { generate: async () => ({ schemaVersion: 1, findings: [{ id: "bad", kind: "pacing", severity: "info", message: "Slow.", passageIds: [], sourceExcerptIds: [] }] }) },
      artifacts,
    })).rejects.toThrow();
    database.close();
  });
});
