import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

async function createApprovedPlanningChain(app: ReturnType<typeof buildApp>) {
  const created = (await app.inject({
    method: "POST",
    url: "/api/long-form/projects",
    payload: { name: "Passage Workspace" },
  })).json();
  const projectId = created.project.id as string;
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
  const routes = (await app.inject({
    method: "POST",
    url: `/api/long-form/projects/${projectId}/routes`,
  })).json();
  await app.inject({
    method: "POST",
    url: `/api/long-form/projects/${projectId}/routes/approve`,
    payload: { versionId: routes.routes.id },
  });
  const endings = (await app.inject({
    method: "POST",
    url: `/api/long-form/projects/${projectId}/endings`,
  })).json();
  await app.inject({
    method: "POST",
    url: `/api/long-form/projects/${projectId}/endings/approve`,
    payload: { versionId: endings.endings.id },
  });
  const mechanics = (await app.inject({
    method: "POST",
    url: `/api/long-form/projects/${projectId}/mechanics`,
  })).json();
  const mechanicsSaved = (await app.inject({
    method: "PUT",
    url: `/api/long-form/projects/${projectId}/mechanics`,
    payload: {
      ...mechanics.mechanics.content,
      choiceEffectPlans: [{
        id: "effect-core",
        label: "Core choice consequences",
        sourceDecisionIds: ["decision-route-selection"],
        mechanicKeys: mechanics.mechanics.content.visibleStats.map((item: { key: string }) => item.key),
        effectGuidance: ["Every tracked value changes only after a consequential choice."],
      }],
    },
  })).json();
  expect((await app.inject({
    method: "POST",
    url: `/api/long-form/projects/${projectId}/mechanics/approve`,
    payload: { versionId: mechanicsSaved.mechanics.id },
  })).statusCode).toBe(200);
  return {
    projectId,
    routes: routes.routes.content,
    endings: endings.endings.content,
    mechanics: mechanicsSaved.mechanics,
  };
}

describe("manual passage-plan workspace", () => {
  it("round-trips, versions, reorders, exports, snapshots, and restores 300 passages offline", async () => {
    const app = buildApp();
    const { projectId, routes, endings } = await createApprovedPlanningChain(app);
    const created = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/passage-plan`,
    });
    expect(created.statusCode).toBe(201);

    const routeId = routes.routes[0].id as string;
    const endingId = endings.endings.find((item: { routeId: string }) => item.routeId === routeId).id as string;
    const passageIds = Array.from({ length: 300 }, (_, index) => `passage-${String(index).padStart(3, "0")}`);
    const passages = passageIds.map((passageId, index) => ({
      id: passageId,
      sequenceId: "sequence-main",
      title: `Passage ${index}`,
      kind: index === 299 ? "epilogue" : "scene",
      purpose: `Plan beat ${index}`,
      summary: "",
      wordTarget: 500,
      routeIds: [routeId],
      tags: [],
      characterIds: [],
      relationshipIds: [],
      locationIds: [],
      requiredFactIds: [],
      revealedFactIds: [],
      setupThreadIds: [],
      payoffThreadIds: [],
      preservedDifferenceIds: [],
      choiceIds: index === 299 ? [] : [`choice-${String(index).padStart(3, "0")}`],
      terminal: index === 299,
      endingId: index === 299 ? endingId : null,
      draftingNotes: [],
      unresolvedQuestions: [],
      planningStatus: "planned",
      position: index,
    }));
    const choices = passageIds.slice(0, -1).map((passageId, index) => ({
      id: `choice-${String(index).padStart(3, "0")}`,
      sourcePassageId: passageId,
      label: "Continue",
      destinationPassageId: passageIds[index + 1],
      narrativeIntent: "",
      consequencePreview: "",
      condition: null,
      unavailableBehavior: "disabled",
      unavailableExplanation: "",
      effects: [],
      sourceDecisionIds: [],
      position: 0,
    }));
    const bundle = {
      schemaVersion: 1,
      structure: {
        schemaVersion: 1,
        title: "Large manual passage plan",
        projectWordTarget: 150_000,
        typicalPathWordTarget: 150_000,
        startPassageId: passageIds[0],
        acts: [{
          id: "act-main",
          label: "Main act",
          purpose: "",
          summary: "",
          wordTarget: 150_000,
          routeIds: [routeId],
          sequenceIds: ["sequence-main"],
          position: 0,
        }],
        sequences: [{
          id: "sequence-main",
          actId: "act-main",
          label: "Main sequence",
          purpose: "",
          summary: "",
          wordTarget: 150_000,
          routeIds: [routeId],
          passageIds,
          entryGoals: [],
          exitGoals: [],
          requiredDecisionIds: [],
          endingHookIds: [],
          position: 0,
          planningStatus: "planned",
        }],
        characterAvailability: [],
      },
      passages,
      choices,
      threads: [],
    };

    const saved = await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/passage-plan`,
      payload: bundle,
    });
    expect(saved.statusCode).toBe(201);
    expect(saved.json()).toMatchObject({
      structure: { content: { startPassageId: "passage-000" } },
      state: { status: "draft" },
    });
    expect(saved.json().passages).toHaveLength(300);
    expect(saved.json().report.budgets.project).toEqual({
      target: 150_000,
      planned: 150_000,
      difference: 0,
    });
    expect(saved.json().report.budgets.acts[0].difference).toBe(0);
    expect(saved.json().report.budgets.sequences[0].difference).toBe(0);

    const reordered = {
      ...bundle,
      structure: {
        ...bundle.structure,
        sequences: [{ ...bundle.structure.sequences[0], passageIds: [...passageIds].reverse() }],
      },
    };
    expect((await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/passage-plan`,
      payload: reordered,
    })).statusCode).toBe(201);
    const reloaded = (await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${projectId}/passage-plan`,
    })).json();
    expect(reloaded.structure.content.sequences[0].passageIds[0]).toBe("passage-299");
    expect(reloaded.passages.map((item: { entityId: string }) => item.entityId)).toContain("passage-000");
    expect((await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${projectId}/passage-plan/entities/passage/passage-000/versions`,
    })).json()).toHaveLength(1);

    const snapshot = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/passage-plan/snapshots`,
    })).json();
    expect((await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/passage-plan/approve`,
      payload: { snapshotId: snapshot.id },
    })).statusCode).toBe(201);
    const unchanged = await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/passage-plan`,
      payload: reordered,
    });
    expect(unchanged.statusCode).toBe(201);
    expect(unchanged.json().state).toMatchObject({
      status: "approved",
      approvedSnapshotId: snapshot.id,
    });

    const markdown = await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${projectId}/passage-plan/export?format=markdown`,
    });
    expect(markdown.headers["content-type"]).toContain("text/markdown");
    expect(markdown.body).toContain("# Large manual passage plan");
    expect(markdown.body).toContain("`passage-299`");
    const canonical = (await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${projectId}/passage-plan/export?format=json`,
    })).json();
    expect(canonical.passages).toHaveLength(300);
    const portable = (await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${projectId}/passage-plan/export?format=bundle`,
    })).json();
    expect(portable).toMatchObject({
      manifest: { format: "story-to-cyoa-portable-project", sourceBodiesIncluded: false },
      project: { id: projectId },
      passagePlan: { state: { status: "approved" } },
    });
    expect(portable.passagePlan.entityVersions.length).toBeGreaterThanOrEqual(599);
    expect(portable.readableMarkdown).toContain("# Large manual passage plan");

    const changed = {
      ...reordered,
      passages: passages.map((passage) => passage.id === "passage-000"
        ? { ...passage, title: "Changed after approval" }
        : passage),
    };
    await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/passage-plan`,
      payload: changed,
    });
    expect((await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/passage-plan/snapshots/${snapshot.id}/restore`,
    })).statusCode).toBe(201);
    const restored = (await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${projectId}/passage-plan`,
    })).json();
    expect(restored.passages.find((item: { entityId: string }) =>
      item.entityId === "passage-000").content.title).toBe("Passage 0");
    expect(restored.state.status).toBe("draft");
    await app.close();
  });

  it("blocks approval on hard findings and persists rationales only for current warnings", async () => {
    const app = buildApp();
    const { projectId } = await createApprovedPlanningChain(app);
    const created = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/passage-plan`,
    })).json();
    const invalidBundle = {
      schemaVersion: 1,
      structure: { ...created.structure.content, startPassageId: "missing-passage" },
      passages: created.passages.map((item: { content: unknown }) => item.content),
      choices: created.choices.map((item: { content: unknown }) => item.content),
      threads: created.threads.map((item: { content: unknown }) => item.content),
    };
    const saved = (await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/passage-plan`,
      payload: invalidBundle,
    })).json();
    expect(saved.report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "graph.start.invalid", severity: "error" }),
    ]));

    const snapshot = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/passage-plan/snapshots`,
    })).json();
    const blocked = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/passage-plan/approve`,
      payload: { snapshotId: snapshot.id },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "graph.start.invalid" }),
    ]));

    const warning = saved.report.findings.find((finding: { severity: string }) =>
      finding.severity === "warning");
    expect(warning).toBeTruthy();
    const acknowledged = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/passage-plan/overrides`,
      payload: {
        code: warning.code,
        entityId: warning.entityId,
        rationale: "This conservative warning is an intentional route exception.",
      },
    });
    expect(acknowledged.statusCode).toBe(201);
    expect(acknowledged.json().report.findings.find((finding: { code: string; entityId: string }) =>
      finding.code === warning.code && finding.entityId === warning.entityId)).toMatchObject({
      acknowledged: true,
      overrideRationale: "This conservative warning is an intentional route exception.",
    });
    const cleared = await app.inject({
      method: "DELETE",
      url: `/api/long-form/projects/${projectId}/passage-plan/overrides?code=${encodeURIComponent(warning.code)}&entityId=${encodeURIComponent(warning.entityId)}`,
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().report.findings.find((finding: { code: string; entityId: string }) =>
      finding.code === warning.code && finding.entityId === warning.entityId)).toMatchObject({
      acknowledged: false,
    });

    expect((await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/passage-plan/overrides`,
      payload: {
        code: "graph.start.invalid",
        entityId: "passage-plan",
        rationale: "Errors cannot be suppressed.",
      },
    })).statusCode).toBe(400);
    await app.close();
  });

  it("validates snapshots against their approved dependency versions, not newer drafts", async () => {
    const app = buildApp();
    const { projectId, mechanics } = await createApprovedPlanningChain(app);
    const draftMechanics = {
      ...mechanics.content,
      visibleStats: [...mechanics.content.visibleStats, {
        id: "stat-unapproved",
        key: "unapproved",
        label: "Unapproved stat",
        description: "This must not be used by an approved passage-plan snapshot.",
        minimum: 0,
        maximum: 5,
        initial: 0,
        increaseSignals: [],
        decreaseSignals: [],
      }],
    };
    expect((await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/mechanics`,
      payload: draftMechanics,
    })).statusCode).toBe(201);

    const created = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/passage-plan`,
    })).json();
    const firstChoice = created.choices[0].content;
    const bundle = {
      schemaVersion: 1,
      structure: created.structure.content,
      passages: created.passages.map((item: { content: unknown }) => item.content),
      choices: created.choices.map((item: { content: unknown }) => item.content).map((choice: typeof firstChoice) =>
        choice.id === firstChoice.id ? {
          ...choice,
          effects: [{
            id: "effect-unapproved",
            mechanicKey: "unapproved",
            operation: "add",
            value: 1,
            feedback: "",
            visibility: "visible",
          }],
        } : choice),
      threads: created.threads.map((item: { content: unknown }) => item.content),
    };
    const saved = (await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/passage-plan`,
      payload: bundle,
    })).json();
    expect(saved.report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "effect.type.invalid", entityId: firstChoice.id }),
    ]));

    const snapshot = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/passage-plan/snapshots`,
    })).json();
    expect(snapshot.upstreamVersions.mechanics).toBe(mechanics.id);
    expect(snapshot.validation.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "effect.type.invalid", entityId: firstChoice.id }),
    ]));
    await app.close();
  });
});
