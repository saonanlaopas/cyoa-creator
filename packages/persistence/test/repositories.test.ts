import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ArtifactRepository, JobRepository, openDatabase, ProjectRepository } from "../src/index.js";

describe("SQLite repositories", () => {
  it("supports projects, immutable versions, rollback, restore, checkpoints and usage", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const jobs = new JobRepository(database);
    const project = projects.create("Demo");
    expect(projects.rename(project.id, "Renamed").name).toBe("Renamed");

    const first = artifacts.saveArtifact({ projectId: project.id, artifactId: "source", content: { text: "one" }, schema: z.object({ text: z.string() }) });
    const second = artifacts.saveArtifact({ projectId: project.id, artifactId: "source", content: { text: "two" } });
    expect([first.version, second.version]).toEqual([1, 2]);
    expect(() => artifacts.saveArtifact({ projectId: project.id, artifactId: "source", content: { bad: true }, schema: z.object({ text: z.string() }) })).toThrow();
    expect(() => artifacts.saveArtifact({ projectId: project.id, artifactId: "source", content: { text: "three" }, simulateFailure: true })).toThrow();
    expect(artifacts.listVersions(project.id, "source")).toHaveLength(2);
    expect(artifacts.restore(project.id, "source", first.id)).toMatchObject({ version: 3, content: { text: "one" } });

    const job = jobs.create(project.id, "analysis");
    expect(jobs.checkpoint(job.id, { chapter: 2 })).toMatchObject({ checkpoint: { chapter: 2 } });
    jobs.recordUsage(job.id, { promptTokens: 10, completionTokens: 5, cost: 0.01 });
    expect(jobs.usageTotals(job.id)).toEqual({ promptTokens: 10, completionTokens: 5, cost: 0.01 });
    expect(projects.duplicate(project.id).id).not.toBe(project.id);
    database.close();
  });

  it("invalidates the canonical dependency chain", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const project = projects.create("Chain");
    for (const type of ["source", "bible", "adaptation", "routes", "drafts", "review", "export"]) {
      artifacts.saveArtifact({ projectId: project.id, artifactId: type, artifactType: type, content: { type } });
    }
    expect(artifacts.markDependentsStale(project.id, "source")).toEqual([
      "adaptation", "bible", "drafts", "export", "review", "routes",
    ]);
    database.close();
  });
});
