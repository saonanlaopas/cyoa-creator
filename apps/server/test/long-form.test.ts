import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactRepository, openDatabase, ProjectRepository, WorkflowRepository } from "@story-to-cyoa/persistence";
import { defaultLongFormStoryBible, defaultProjectBrief } from "@story-to-cyoa/pipeline";
import { buildApp } from "../src/app.js";

describe("long-form project brief", () => {
  it("versions Creative Direction with material-only staleness and exact provenance", async () => {
    const app = buildApp();
    const created = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Direction Project" } })).json();
    const projectId = created.project.id as string;
    expect(created.creativeDirection).toMatchObject({ artifactId: "creative-direction", version: 1, content: { schemaId: "cyoa.creative-direction" } });
    expect(created.creativeDirectionWorkflow.status).toBe("draft");
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`, payload: { versionId: created.brief.id } });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`, payload: { versionId: created.creativeDirection.id } });
    const bible = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/bible` })).json();
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`, payload: { versionId: bible.bible.id } });

    const provenanceOnly = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/creative-direction`,
      payload: { ...created.creativeDirection.content, fieldProvenance: [{
        fieldPath: "/tone", reference: { kind: "manual-edit", versionId: created.creativeDirection.id, excerpt: "Why this default exists" },
      }] },
    });
    expect(provenanceOnly.statusCode).toBe(201);
    expect(provenanceOnly.json().creativeDirection.content.materialFingerprint).toBe(created.creativeDirection.content.materialFingerprint);
    expect(provenanceOnly.json().creativeDirection.content.provenanceFingerprint).not.toBe(created.creativeDirection.content.provenanceFingerprint);
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`, payload: { versionId: provenanceOnly.json().creativeDirection.id } });
    let state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}` })).json();
    expect(state.workflow.bible.status).toBe("approved");
    expect(state.bible.stale).toBe(false);

    const noOp = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/creative-direction`,
      payload: provenanceOnly.json().creativeDirection.content,
    })).json();
    state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}` })).json();
    expect(state.workflow.bible.status).toBe("approved");
    expect(state.bible.stale).toBe(false);
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`, payload: { versionId: noOp.creativeDirection.id } });
    state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}` })).json();
    expect(state.workflow.bible.status).toBe("approved");
    expect(state.bible.stale).toBe(false);

    const restoredEquivalent = (await app.inject({
      method: "POST", url: `/api/projects/${projectId}/artifacts/creative-direction/restore`,
      payload: { versionId: created.creativeDirection.id },
    })).json();
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`, payload: { versionId: restoredEquivalent.version.id } });
    state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}` })).json();
    expect(state.workflow.bible.status).toBe("approved");
    expect(state.bible.stale).toBe(false);

    const material = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/creative-direction`,
      payload: { ...provenanceOnly.json().creativeDirection.content, tone: { ...provenanceOnly.json().creativeDirection.content.tone, descriptors: ["uncanny", "tense"] } },
    });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`, payload: { versionId: material.json().creativeDirection.id } });
    state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}` })).json();
    expect(state.workflow.bible.status).toBe("stale");
    expect(state.bible.stale).toBe(true);

    const exported = await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/creative-direction/export?format=json` });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().artifact.content.materialFingerprint).toBe(material.json().creativeDirection.content.materialFingerprint);
    const context = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/creative-direction/context-preview` })).json();
    expect(context.diagnostics).toMatchObject({
      artifactVersionId: material.json().creativeDirection.id,
      materialFingerprint: material.json().creativeDirection.content.materialFingerprint,
      omittedRelationshipProfileIds: [], omittedScopedVariationIds: [], tokenEstimateKind: "estimated",
      hardLimitBytes: expect.any(Number), hardLimits: expect.any(Object),
    });
    await app.close();
  });

  it("rejects cross-project Creative Direction provenance before any version is written", async () => {
    const app = buildApp();
    const first = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "First" } })).json();
    const second = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Second" } })).json();
    const rejected = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${first.project.id}/creative-direction`,
      payload: { ...first.creativeDirection.content, fieldProvenance: [{
        fieldPath: "/tone", reference: { kind: "approved-artifact", targetId: "brief", versionId: second.brief.id },
      }] },
    });
    expect(rejected.statusCode).toBe(400);
    const state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${first.project.id}` })).json();
    expect(state.creativeDirection.version).toBe(1);
    await app.close();
  });

  it("opens a pre-A1 project unchanged and creates only an explicit migration-derived adoption draft", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-legacy-direction-"));
    const databasePath = join(directory, "story.sqlite");
    const database = openDatabase(databasePath);
    const project = new ProjectRepository(database).create("Legacy project", "legacy-project", "long-form");
    const artifacts = new ArtifactRepository(database); const workflow = new WorkflowRepository(database);
    const briefContent = { ...defaultProjectBrief("Legacy project"), tone: "uncanny", pointOfView: "first-person" as const };
    const brief = artifacts.saveArtifact({ projectId: project.id, artifactId: "brief", artifactType: "brief", schemaVersion: 1, content: briefContent });
    workflow.approve(project.id, "brief", brief.id);
    const bibleContent = defaultLongFormStoryBible({
      title: "Legacy project", overview: "Historical overview", protagonist: "Mara", pointOfView: "first-person", tone: "restrained",
    });
    const bible = artifacts.saveArtifact({ projectId: project.id, artifactId: "bible", artifactType: "bible", schemaVersion: 1, content: bibleContent });
    workflow.approve(project.id, "bible", bible.id);
    const exactBefore = artifacts.listVersions(project.id, "brief").concat(artifacts.listVersions(project.id, "bible"));
    database.close();

    const app = buildApp({ databasePath });
    try {
      const opened = (await app.inject({ method: "GET", url: `/api/long-form/projects/${project.id}` })).json();
      expect(opened.creativeDirection).toBeNull();
      expect(opened.workflow["creative-direction"]).toMatchObject({ status: "empty", approvedVersionId: null });
      const adopted = await app.inject({ method: "POST", url: `/api/long-form/projects/${project.id}/creative-direction/adopt-legacy` });
      expect(adopted.statusCode).toBe(201);
      expect(adopted.json()).toMatchObject({ workflow: { status: "draft", approvedVersionId: null } });
      expect(adopted.json().artifact.content.prose.pointOfView).toBe("first-person");
      expect(adopted.json().artifact.content.fieldProvenance).toEqual(expect.arrayContaining([
        expect.objectContaining({ reference: expect.objectContaining({ kind: "migration-derived", versionId: brief.id }) }),
        expect.objectContaining({ reference: expect.objectContaining({ kind: "migration-derived", versionId: bible.id }) }),
      ]));
      const reopenedDatabase = openDatabase(databasePath);
      expect(new ArtifactRepository(reopenedDatabase).listVersions(project.id, "brief")
        .concat(new ArtifactRepository(reopenedDatabase).listVersions(project.id, "bible"))).toEqual(exactBefore);
      reopenedDatabase.close();
    } finally {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("duplicates complete Creative Direction history with remapped project-owned provenance", async () => {
    const app = buildApp();
    const source = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Source" } })).json();
    const saved = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${source.project.id}/creative-direction`,
      payload: { ...source.creativeDirection.content, tone: { ...source.creativeDirection.content.tone, descriptors: ["hopeful"] }, fieldProvenance: [{
        fieldPath: "/tone", reference: { kind: "manual-edit", versionId: source.creativeDirection.id, excerpt: "Source edit" },
      }] },
    })).json();
    await app.inject({ method: "POST", url: `/api/long-form/projects/${source.project.id}/creative-direction/approve`, payload: { versionId: saved.creativeDirection.id } });
    const copy = (await app.inject({ method: "POST", url: `/api/projects/${source.project.id}/duplicate`, payload: { name: "Copy" } })).json();
    const state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${copy.id}` })).json();
    const history = (await app.inject({ method: "GET", url: `/api/projects/${copy.id}/artifacts/creative-direction/versions` })).json();
    expect(history).toHaveLength(2);
    expect(state.workflow["creative-direction"]).toMatchObject({ status: "approved", approvedVersionId: history[0].id });
    expect(state.creativeDirection.content.materialFingerprint).toBe(saved.creativeDirection.content.materialFingerprint);
    const referenceVersionId = state.creativeDirection.content.fieldProvenance[0].reference.versionId;
    expect(history.map((item: { id: string }) => item.id)).toContain(referenceVersionId);
    expect(referenceVersionId).not.toBe(source.creativeDirection.id);
    await app.close();
  });

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

  it("promotes route hooks into detailed, budgeted, versioned endings", async () => {
    const app = buildApp();
    const created = (await app.inject({
      method: "POST", url: "/api/long-form/projects", payload: { name: "Ending Project" },
    })).json();
    const projectId = created.project.id as string;
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`,
      payload: { versionId: created.brief.id },
    });
    const bible = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible`,
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: bible.bible.id },
    });
    const routes = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/routes`,
    })).json();
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/endings`,
    })).statusCode).toBe(409);
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/routes/approve`,
      payload: { versionId: routes.routes.id },
    });

    const createdEndings = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/endings`,
    });
    expect(createdEndings.statusCode).toBe(201);
    const plan = createdEndings.json().endings.content;
    expect(plan.endings).toHaveLength(routes.routes.content.endingHooks.length);
    expect(plan.endings.reduce((total: number, ending: { wordTarget: number }) => total + ending.wordTarget, 0))
      .toBe(plan.endingWordTarget);

    const incomplete = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/endings`,
      payload: { ...plan, endings: plan.endings.slice(1) },
    })).json();
    const blockedApproval = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/endings/approve`,
      payload: { versionId: incomplete.endings.id },
    });
    expect(blockedApproval.statusCode).toBe(409);
    expect(blockedApproval.json().error).toContain("hook");

    const saved = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/endings`,
      payload: {
        ...plan,
        endings: plan.endings.map((ending: { id: string }) => ending.id === "ending-1"
          ? { ...ending, title: "Forgiveness", summary: "The protagonist chooses repair.", thematicPayoff: "Accountability permits change.", requirements: ["Chose honesty"] }
          : ending),
      },
    });
    expect(saved.statusCode).toBe(201);
    const endingVersionId = saved.json().endings.id as string;
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/endings/approve`,
      payload: { versionId: endingVersionId },
    });
    const markdown = await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/endings/export?format=markdown`,
    });
    expect(markdown.body).toContain("## Forgiveness");
    expect(markdown.body).toContain("Chose honesty");

    const mechanicsCreated = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/mechanics`,
    })).json();
    expect(mechanicsCreated.mechanics.content.visibleStats).toHaveLength(3);
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`,
      payload: { versionId: mechanicsCreated.mechanics.id },
    })).statusCode).toBe(409);
    const mechanicsSaved = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/mechanics`,
      payload: {
        ...mechanicsCreated.mechanics.content,
        choiceEffectPlans: [{
          id: "effect-core",
          label: "Core choice consequences",
          sourceDecisionIds: ["decision-route-selection"],
          mechanicKeys: ["resolve", "insight", "integrity"],
          effectGuidance: ["Choices change values only when they carry narrative cost."],
        }],
      },
    })).json();
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`,
      payload: { versionId: mechanicsSaved.mechanics.id },
    })).statusCode).toBe(200);

    await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/routes`,
      payload: { ...routes.routes.content, overview: "Revised routes." },
    });
    const reloaded = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}`,
    })).json();
    expect(reloaded.workflow.endings.status).toBe("stale");
    expect(reloaded.endings.stale).toBe(true);
    expect(reloaded.workflow.mechanics.status).toBe("stale");
    await app.close();
  });
});
