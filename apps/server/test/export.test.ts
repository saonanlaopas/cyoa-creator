import fastify from "fastify";
import { describe, expect, it } from "vitest";
import { ArtifactRepository, openDatabase, ProjectRepository } from "@story-to-cyoa/persistence";
import { registerExportRoutes } from "../src/routes/export.js";
import { routeFixture } from "./playtest.test.js";

describe("export routes", () => {
  it("downloads editable Twee and standalone HTML", async () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const project = projects.create("Exportable");
    artifacts.saveArtifact({ projectId: project.id, artifactId: "drafts", content: routeFixture(project.id) });
    const app = fastify();
    registerExportRoutes(app, projects, artifacts);
    const twee = await app.inject({ method: "GET", url: `/api/projects/${project.id}/export/twee` });
    expect(twee.statusCode).toBe(200);
    expect(twee.body).toContain(":: StoryData");
    const html = await app.inject({ method: "GET", url: `/api/projects/${project.id}/export/html` });
    expect(html.statusCode).toBe(200);
    expect(html.body.toLowerCase()).toContain("<!doctype html>");
    await app.close();
    database.close();
  });
});
