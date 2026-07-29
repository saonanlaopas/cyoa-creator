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

  it("gates, versions, approves, exports, and invalidates the long-form story bible", async () => {
    const app = buildApp();
    const created = (await app.inject({
      method: "POST",
      url: "/api/long-form/projects",
      payload: { name: "Bible Project" },
    })).json();
    const projectId = created.project.id as string;
    expect((await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/bible`,
    })).statusCode).toBe(409);

    await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/brief/approve`,
      payload: { versionId: created.brief.id },
    });
    const bibleCreated = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/bible`,
    });
    expect(bibleCreated.statusCode).toBe(201);
    expect(bibleCreated.json()).toMatchObject({
      bible: { version: 1, content: { title: "Bible Project story bible" } },
      workflow: { status: "draft" },
    });

    const candidate = {
      ...bibleCreated.json().bible.content,
      characters: [{
        id: "character-mara",
        name: "Mara",
        role: "Student",
        summary: "She underestimated the course.",
        motivations: ["Survive"],
        knowledge: ["The professor is hiding something"],
        plannedArc: "From avoidance to responsibility.",
      }],
      canonFacts: [{
        id: "fact-course",
        statement: "FAE 200 appears to be an easy general-education course.",
        sourceExcerptIds: ["chapter-1-block-1"],
        confidence: "confirmed",
      }],
    };
    const saved = await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/bible`,
      payload: candidate,
    });
    expect(saved.statusCode).toBe(201);
    const bibleVersionId = saved.json().bible.id as string;
    expect((await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: bibleVersionId },
    })).json()).toMatchObject({ status: "approved", approvedVersionId: bibleVersionId });

    const markdown = await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${projectId}/bible/export?format=markdown`,
    });
    expect(markdown.statusCode).toBe(200);
    expect(markdown.body).toContain("# Bible Project story bible");
    expect(markdown.body).toContain("### Mara");
    expect(markdown.body).toContain("FAE 200");

    await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/brief`,
      payload: { ...created.brief.content, premise: "A changed premise." },
    });
    const reloaded = (await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${projectId}`,
    })).json();
    expect(reloaded.workflow.bible.status).toBe("stale");
    expect(reloaded.bible.stale).toBe(true);
    await app.close();
  });

  it("creates, budgets, versions, approves, exports, and invalidates route architecture", async () => {
    const app = buildApp();
    const created = (await app.inject({
      method: "POST",
      url: "/api/long-form/projects",
      payload: { name: "Route Project" },
    })).json();
    const projectId = created.project.id as string;
    expect((await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/routes`,
    })).statusCode).toBe(409);

    await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/brief/approve`,
      payload: { versionId: created.brief.id },
    });
    const bible = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/bible`,
    })).json();
    await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: bible.bible.id },
    });

    const routesCreated = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/routes`,
    });
    expect(routesCreated.statusCode).toBe(201);
    const routePlan = routesCreated.json().routes.content;
    expect(routePlan.routes).toHaveLength(created.brief.content.routeTarget);
    expect(routePlan.endingHooks).toHaveLength(created.brief.content.endingTarget);
    expect(routePlan.acts.reduce((total: number, act: { wordTarget: number }) => total + act.wordTarget, 0))
      .toBe(created.brief.content.totalWordTarget);

    const saved = await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/routes`,
      payload: {
        ...routePlan,
        routes: routePlan.routes.map((route: { id: string; name: string }) =>
          route.id === "route-1" ? { ...route, name: "Forgiveness route" } : route),
      },
    });
    expect(saved.statusCode).toBe(201);
    const routeVersionId = saved.json().routes.id as string;
    expect((await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/routes/approve`,
      payload: { versionId: routeVersionId },
    })).json()).toMatchObject({ status: "approved", approvedVersionId: routeVersionId });

    const markdown = await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${projectId}/routes/export?format=markdown`,
    });
    expect(markdown.statusCode).toBe(200);
    expect(markdown.body).toContain("Forgiveness route");
    expect(markdown.body).toContain("175,000");

    await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/bible`,
      payload: { ...bible.bible.content, overview: "A revised canonical overview." },
    });
    const reloaded = (await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${projectId}`,
    })).json();
    expect(reloaded.workflow.routes.status).toBe("stale");
    expect(reloaded.routes.stale).toBe(true);
    await app.close();
  });
});
