import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("long-form project brief", () => {
  it("creates, persists, approves, and exports a validated brief", async () => {
    const app = buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/long-form/projects",
      payload: { name: "The Long Road" },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.project).toMatchObject({ name: "The Long Road", mode: "long-form" });
    expect(body.brief.content).toMatchObject({ totalWordTarget: 175_000, branchingStyle: "braided" });

    const brief = {
      ...body.brief.content,
      premise: "A student discovers why an apparently easy course has no surviving graduates.",
      protagonist: "The student",
      totalWordTarget: 190_000,
    };
    const saved = await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${body.project.id}/brief`,
      payload: brief,
    });
    expect(saved.statusCode).toBe(201);
    expect(saved.json().workflow.status).toBe("draft");

    const versionId = saved.json().brief.id as string;
    expect((await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${body.project.id}/brief/approve`,
      payload: { versionId },
    })).json()).toMatchObject({ status: "approved", approvedVersionId: versionId });

    const markdown = await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${body.project.id}/brief/export?format=markdown`,
    });
    expect(markdown.headers["content-type"]).toContain("text/markdown");
    expect(markdown.body).toContain("# The Long Road");
    expect(markdown.body).toContain("190,000");

    const reloaded = (await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${body.project.id}`,
    })).json();
    expect(reloaded.brief.content.premise).toContain("apparently easy course");
    expect(reloaded.workflow.brief.status).toBe("approved");
    await app.close();
  });

  it("rejects invalid budgets and quick-project access", async () => {
    const app = buildApp();
    const longForm = (await app.inject({
      method: "POST",
      url: "/api/long-form/projects",
      payload: { name: "Invalid" },
    })).json();
    const invalid = {
      ...longForm.brief.content,
      totalWordTarget: 100_000,
      typicalPlaythroughWordTarget: 100_000,
    };
    expect((await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${longForm.project.id}/brief`,
      payload: invalid,
    })).statusCode).toBe(400);

    const quick = (await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Quick" },
    })).json();
    expect((await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${quick.id}`,
    })).statusCode).toBe(404);
    await app.close();
  });
});
