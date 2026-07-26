import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("project routes", () => {
  it("creates, renames, duplicates and archives projects", async () => {
    const app = buildApp();
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Novel" } });
    expect(created.statusCode).toBe(201);
    const project = created.json();
    expect((await app.inject({ method: "GET", url: `/api/projects/${project.id}` })).json()).toMatchObject({ name: "Novel" });
    expect((await app.inject({ method: "PATCH", url: `/api/projects/${project.id}`, payload: { name: "Game" } })).json()).toMatchObject({ name: "Game" });
    expect((await app.inject({ method: "POST", url: `/api/projects/${project.id}/duplicate`, payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/api/projects/${project.id}/archive` })).json()).toMatchObject({ archived: true });
    await app.close();
  });
});
