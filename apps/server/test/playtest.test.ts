import fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { Project } from "@story-to-cyoa/domain";
import { ArtifactRepository, openDatabase, ProjectRepository } from "@story-to-cyoa/persistence";
import { registerPlaytestRoutes } from "../src/routes/playtest.js";

export function routeFixture(id: string): Project {
  return {
    id, name: "Playable", schemaVersion: 1, startPassageId: "start", metadata: {},
    mechanics: { visibleStats: {}, relationships: {}, hiddenFlags: {}, inventory: [], protagonistTendencies: [], divergenceMode: "balanced", randomness: false },
    passages: [
      { id: "start", title: "Start", purpose: "", prose: "Begin.", participants: [], requiredKnowledge: [], incomingAssumptions: [], ending: null, choices: [{ id: "go", label: "Go", destinationId: "end", conditions: [], effects: [], hardGate: false }] },
      { id: "end", title: "End", purpose: "", prose: "Done.", participants: [], requiredKnowledge: [], incomingAssumptions: [], ending: "success", choices: [] },
    ],
  } as Project;
}

describe("playtest routes", () => {
  it("simulates and versions a canonical draft", async () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const project = projects.create("Playable");
    artifacts.saveArtifact({ projectId: project.id, artifactId: "drafts", content: routeFixture(project.id) });
    const app = fastify();
    registerPlaytestRoutes(app, projects, artifacts);
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/playtest/simulate`, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ reachableEndingIds: ["end"], exhaustive: true });
    expect(artifacts.getCurrent(project.id, "simulation")).toBeDefined();
    await app.close();
    database.close();
  });
});
