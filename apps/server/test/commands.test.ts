import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("command and quick-draft routes", () => {
  it("creates a quick draft at the API endpoint", async () => {
    const app = buildApp();

    const response = await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} });

    expect(response.statusCode).toBe(201);
    await app.close();
  });

  it("creates a stable local draft and project-scoped command", async () => {
    const app = buildApp();
    const draft = await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} });
    expect(draft.statusCode).toBe(201);
    expect(draft.json()).toMatchObject({ name: "Untitled adaptation" });
    const projectId = draft.json().projectId as string;

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/commands`,
      payload: { name: "Tone", instruction: "Use a mature tone." },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ scope: "project", projectId, enabled: true, position: 0 });
    await app.close();
  });

  it("supports global command CRUD independently of project commands", async () => {
    const app = buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/commands/global",
      payload: { name: "Canon", instruction: "Preserve characterization.", position: 2 },
    });
    const commandId = created.json().id as string;
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ scope: "global", projectId: null, position: 2 });
    expect((await app.inject({ method: "GET", url: "/api/commands/global" })).json()).toHaveLength(1);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/commands/global/${commandId}`,
      payload: { enabled: false, position: 3 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ enabled: false, position: 3 });
    expect((await app.inject({ method: "DELETE", url: `/api/commands/global/${commandId}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/commands/global" })).json()).toEqual([]);
    await app.close();
  });

  it("updates, lists, and deletes project commands only within their project", async () => {
    const app = buildApp();
    const projectId = (await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} })).json().projectId as string;
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/commands`,
      payload: { name: "Routes", instruction: "Use four endings." },
    });
    const commandId = created.json().id as string;

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/commands/${commandId}`,
      payload: { name: "Branches", instruction: "Use three endings.", position: 1 },
    });
    const listed = await app.inject({ method: "GET", url: `/api/projects/${projectId}/commands` });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: "Branches", instruction: "Use three endings.", position: 1 });
    expect(listed.json()).toHaveLength(1);
    expect((await app.inject({ method: "DELETE", url: `/api/projects/${projectId}/commands/${commandId}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/projects/${projectId}/commands` })).json()).toEqual([]);
    await app.close();
  });

  it("lists enabled globals before enabled commands for the requested project", async () => {
    const app = buildApp();
    const first = (await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} })).json().projectId as string;
    const second = (await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} })).json().projectId as string;
    await app.inject({ method: "POST", url: "/api/commands/global", payload: { name: "Global", instruction: "Everywhere." } });
    await app.inject({ method: "POST", url: `/api/projects/${first}/commands`, payload: { name: "First", instruction: "Only first." } });
    await app.inject({ method: "POST", url: `/api/projects/${second}/commands`, payload: { name: "Disabled", instruction: "Not included.", enabled: false } });

    const effective = await app.inject({ method: "GET", url: `/api/projects/${first}/commands/effective` });

    expect(effective.statusCode).toBe(200);
    expect(effective.json().map((command: { name: string }) => command.name)).toEqual(["Global", "First"]);
    await app.close();
  });

  it("promotes a project command by copying it globally without changing the original", async () => {
    const app = buildApp();
    const projectId = (await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} })).json().projectId as string;
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/commands`,
      payload: { name: "Tone", instruction: "Use a mature tone.", enabled: false, position: 4 },
    });
    const original = created.json();

    const promoted = await app.inject({ method: "POST", url: `/api/projects/${projectId}/commands/${original.id}/promote` });

    expect(promoted.statusCode).toBe(201);
    expect(promoted.json()).toMatchObject({ scope: "global", projectId: null, name: original.name, instruction: original.instruction, enabled: false, position: 4 });
    expect(promoted.json().id).not.toBe(original.id);
    expect((await app.inject({ method: "GET", url: `/api/projects/${projectId}/commands` })).json()).toEqual([original]);
    await app.close();
  });

  it("rejects invalid command bodies and missing projects deterministically", async () => {
    const app = buildApp();
    const projectBody = await app.inject({ method: "POST", url: "/api/projects/missing/commands", payload: { name: "Tone", instruction: "Use it." } });
    const invalidGlobal = await app.inject({ method: "POST", url: "/api/commands/global", payload: { name: "", instruction: 1 } });
    const invalidPatch = await app.inject({ method: "PATCH", url: "/api/commands/global/missing", payload: { enabled: "yes" } });
    const missingEffective = await app.inject({ method: "GET", url: "/api/projects/missing/commands/effective" });

    expect(projectBody).toMatchObject({ statusCode: 404 });
    expect(projectBody.json()).toEqual({ error: "Project not found" });
    expect(invalidGlobal).toMatchObject({ statusCode: 400 });
    expect(invalidGlobal.json()).toEqual({ error: "name must be a non-empty string" });
    expect(invalidPatch).toMatchObject({ statusCode: 400 });
    expect(invalidPatch.json()).toEqual({ error: "enabled must be a boolean" });
    expect(missingEffective).toMatchObject({ statusCode: 404 });
    expect(missingEffective.json()).toEqual({ error: "Project not found" });
    await app.close();
  });

  it("returns 404 for missing and cross-project command IDs", async () => {
    const app = buildApp();
    const first = (await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} })).json().projectId as string;
    const second = (await app.inject({ method: "POST", url: "/api/quick/drafts", payload: {} })).json().projectId as string;
    const command = (await app.inject({ method: "POST", url: `/api/projects/${first}/commands`, payload: { name: "First", instruction: "Only here." } })).json();

    const crossProject = await app.inject({ method: "PATCH", url: `/api/projects/${second}/commands/${command.id}`, payload: { name: "Nope" } });
    const missing = await app.inject({ method: "DELETE", url: "/api/commands/global/missing" });
    const promoteCrossProject = await app.inject({ method: "POST", url: `/api/projects/${second}/commands/${command.id}/promote` });

    expect(crossProject).toMatchObject({ statusCode: 404 });
    expect(crossProject.json()).toEqual({ error: "Command not found" });
    expect(missing).toMatchObject({ statusCode: 404 });
    expect(missing.json()).toEqual({ error: "Command not found" });
    expect(promoteCrossProject).toMatchObject({ statusCode: 404 });
    expect(promoteCrossProject.json()).toEqual({ error: "Command not found" });
    await app.close();
  });
});
