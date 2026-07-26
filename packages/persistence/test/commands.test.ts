import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CommandRepository, openDatabase, ProjectRepository } from "../src/index.js";

describe("CommandRepository", () => {
  it("keeps project commands isolated and orders enabled globals before enabled project commands", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const commands = new CommandRepository(database);
    const first = projects.create("First", "project-1");
    const second = projects.create("Second", "project-2");
    commands.create({ name: "Later global", instruction: "Apply later.", scope: "global", position: 2 });
    commands.create({ name: "First global", instruction: "Apply first.", scope: "global", position: 1 });
    commands.create({ name: "Dark", instruction: "Use a mature tone.", scope: "project", projectId: first.id, position: 1 });
    commands.create({ name: "Canon", instruction: "Preserve characterization.", scope: "project", projectId: first.id, position: 0 });
    commands.create({ name: "Other", instruction: "Only for the other project.", scope: "project", projectId: second.id });

    expect(commands.listEffective(first.id).map((item) => item.name)).toEqual([
      "First global", "Later global", "Canon", "Dark",
    ]);
    expect(commands.listEffective(second.id).map((item) => item.name)).toEqual([
      "First global", "Later global", "Other",
    ]);
    database.close();
  });

  it("persists enabled state, ordering, edits, and deletion", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const commands = new CommandRepository(database);
    const projectId = projects.create("Persistent", "persistent-project").id;
    const command = commands.create({ name: "Routes", instruction: "Use four endings.", scope: "project", projectId });

    expect(commands.update(command.id, { name: "Branches", instruction: "Use three endings.", enabled: false, position: 4 }))
      .toMatchObject({ name: "Branches", instruction: "Use three endings.", enabled: false, position: 4 });
    expect(commands.listEffective(projectId)).toEqual([]);
    commands.delete(command.id);
    expect(commands.list({ scope: "project", projectId })).toEqual([]);
    database.close();
  });

  it("rejects blank fields and invalid scope or project combinations", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const commands = new CommandRepository(database);
    const project = projects.create("Validation");
    const command = commands.create({ name: "Valid", instruction: "Do this.", scope: "project", projectId: project.id });

    expect(() => commands.create({ name: "   ", instruction: "Do this.", scope: "global" })).toThrow("Command name is required");
    expect(() => commands.create({ name: "Valid", instruction: " \n", scope: "global" })).toThrow("Command instruction is required");
    expect(() => commands.create({ name: "Missing", instruction: "Do this.", scope: "project" })).toThrow("Project command requires a project ID");
    expect(() => commands.create({ name: "Global", instruction: "Do this.", scope: "global", projectId: project.id })).toThrow("Global command cannot have a project ID");
    expect(() => commands.create({ name: "Unknown", instruction: "Do this.", scope: "project", projectId: "missing" })).toThrow("Project not found");
    expect(() => commands.update(command.id, { name: "  " })).toThrow("Command name is required");
    expect(() => commands.update(command.id, { instruction: "" })).toThrow("Command instruction is required");
    database.close();
  });

  it("rejects effective-command lookup for an unknown project", () => {
    const database = openDatabase();
    const commands = new CommandRepository(database);
    commands.create({ name: "Global", instruction: "Apply everywhere.", scope: "global" });

    expect(() => commands.listEffective("missing-project")).toThrow("Project not found");
    database.close();
  });

  it("cascades project commands when their project is deleted", () => {
    const database = openDatabase();
    const projects = new ProjectRepository(database);
    const commands = new CommandRepository(database);
    const project = projects.create("Disposable");
    commands.create({ name: "Scoped", instruction: "Only here.", scope: "project", projectId: project.id });
    database.prepare("DELETE FROM projects WHERE id = ?").run(project.id);

    expect(commands.list({ scope: "project", projectId: project.id })).toEqual([]);
    database.close();
  });

  it("survives closing and reopening the SQLite file", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-commands-"));
    const path = join(directory, "commands.sqlite");
    const first = openDatabase(path);
    new CommandRepository(first).create({ name: "Canon", instruction: "Preserve voice.", scope: "global" });
    first.close();
    const second = openDatabase(path);
    expect(new CommandRepository(second).list({ scope: "global" })).toHaveLength(1);
    second.close();
  });
});
