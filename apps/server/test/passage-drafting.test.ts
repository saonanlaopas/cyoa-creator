import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { DeterministicPassagePlanningProvider } from "../src/services/passage-planning-provider.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

async function createApprovedFixture(app: ReturnType<typeof buildApp>) {
  const created = (await app.inject({
    method: "POST", url: "/api/long-form/projects", payload: { name: "Draft architecture" },
  })).json();
  const projectId = created.project.id as string;
  await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`, payload: { versionId: created.brief.id },
  });
  let bibleArtifact: { id: string; content: Record<string, unknown> } | undefined;
  for (const artifactId of ["bible", "routes", "endings"] as const) {
    const response = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}`,
    })).json();
    if (artifactId === "bible") bibleArtifact = response.bible;
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}/approve`,
      payload: { versionId: response[artifactId].id },
    });
  }
  const mechanics = (await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/mechanics`,
  })).json();
  const mechanicsSaved = (await app.inject({
    method: "PUT", url: `/api/long-form/projects/${projectId}/mechanics`, payload: {
      ...mechanics.mechanics.content,
      choiceEffectPlans: [{
        id: "effect-draft", label: "Draft fixture", sourceDecisionIds: ["decision-route-selection"],
        mechanicKeys: mechanics.mechanics.content.visibleStats.map((item: { key: string }) => item.key),
        effectGuidance: ["Keep consequences visible."],
      }],
    },
  })).json();
  await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`,
    payload: { versionId: mechanicsSaved.mechanics.id },
  });
  const plan = (await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan`,
  })).json();
  const snapshot = (await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots`,
  })).json();
  const approved = await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`,
    payload: { snapshotId: snapshot.id },
  });
  expect(approved.statusCode).toBe(201);
  return { projectId, plan, snapshot, bible: bibleArtifact! };
}

async function waitForGeneration(app: ReturnType<typeof buildApp>, projectId: string, jobId: string) {
  for (let index = 0; index < 100; index++) {
    const job = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${jobId}`,
    })).json();
    if (["completed", "partially_failed", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Offline planning job did not finish");
}

describe("Foundation 4B-1 draft architecture API", () => {
  it("saves Unicode manual candidates with exact provenance, immutable history, and restore", async () => {
    const app = buildApp();
    const { projectId, plan } = await createApprovedFixture(app);
    const passage = plan.passages[0];
    const prose = "Fanawë Eterúna walks into 東京. The river remembers.";
    const first = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${passage.entityId}`,
      payload: { proseMarkdown: prose, authorNote: "Manual only" },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().draft).toMatchObject({
      version: 1, proseMarkdown: prose, wordCount: 8, lifecycleStatus: "candidate",
      basedOnPassagePlanVersionId: passage.id, sourceKind: "manual",
    });
    expect(Object.keys(first.json().draft.upstreamVersions).sort()).toEqual([
      "bible", "brief", "endings", "mechanics", "routes",
    ]);

    const second = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${passage.entityId}`,
      payload: { proseMarkdown: "A second immutable version.", authorNote: "" },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().state.history.map((item: { version: number }) => item.version)).toEqual([2, 1]);
    const restored = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/passages/${passage.entityId}/restore`,
      payload: { versionId: first.json().draft.id },
    });
    expect(restored.statusCode).toBe(201);
    expect(restored.json().draft).toMatchObject({
      version: 3, proseMarkdown: prose, sourceKind: "restore", restoredFromVersionId: first.json().draft.id,
    });
    expect(restored.json().state.history).toHaveLength(3);
    await app.close();
  });

  it("applies centralized material, cosmetic, unrelated, and upstream staleness rules", async () => {
    const app = buildApp();
    const { projectId, plan, bible: approvedBible } = await createApprovedFixture(app);
    const selected = plan.passages[0];
    const unrelated = plan.passages[1];
    const saved = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
      payload: { proseMarkdown: "Current prose stays stored.", authorNote: "" },
    })).json();

    await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/passage-plan/entities/passage/${unrelated.entityId}`,
      payload: { ...unrelated.content, purpose: `${unrelated.content.purpose} changed` },
    });
    await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/passage-plan/entities/passage/${selected.entityId}`,
      payload: { ...selected.content, title: "Cosmetic title" },
    });
    let state = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
    })).json();
    expect(state.head.current).toMatchObject({ id: saved.draft.id, stale: false, proseMarkdown: "Current prose stays stored." });

    const cosmeticHead = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/passage-plan`,
    })).json().passages.find((item: { entityId: string }) => item.entityId === selected.entityId);
    await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/passage-plan/entities/passage/${selected.entityId}`,
      payload: { ...cosmeticHead.content, wordTarget: cosmeticHead.content.wordTarget + 100 },
    });
    state = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
    })).json();
    expect(state.head.current.stale).toBe(true);
    expect(state.head.current.staleReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "passage-plan-material-change", changedFields: ["wordTarget"] }),
    ]));
    expect(state.head.current.proseMarkdown).toBe("Current prose stays stored.");

    const restored = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}/restore`,
      payload: { versionId: saved.draft.id },
    })).json();
    expect(restored.draft.stale).toBe(true);
    expect(restored.draft.staleReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "passage-plan-material-change", changedFields: ["wordTarget"] }),
    ]));
    const refreshed = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
      payload: { proseMarkdown: restored.draft.proseMarkdown, authorNote: "Fresh against the current passage plan" },
    })).json();
    expect(refreshed.draft.stale).toBe(false);
    const bible = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/bible`,
      payload: { ...approvedBible.content, overview: `${String(approvedBible.content.overview ?? "")} revised` },
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: bible.bible.id },
    });
    state = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
    })).json();
    expect(state.head.current.stale).toBe(false);

    const globalBible = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/bible`,
      payload: {
        ...bible.bible.content,
        proseGuidance: {
          ...bible.bible.content.proseGuidance,
          style: [...bible.bible.content.proseGuidance.style, "Use clipped scene endings."],
        },
      },
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: globalBible.bible.id },
    });
    state = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
    })).json();
    expect(state.head.current.staleReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reasonCode: "approved-upstream-version-change",
        sourceEntityId: "bible",
        fromVersionId: approvedBible.id,
        toVersionId: globalBible.bible.id,
      }),
    ]));
    await app.close();
  });

  it("uses the same staleness observer when a Foundation 4A proposal applies a material change", async () => {
    const materialUnits: string[] = [];
    const provider = new DeterministicPassagePlanningProvider({ materialPurposeChangeForUnitIds: materialUnits });
    const app = buildApp({ passagePlanningProvider: provider });
    const { projectId, plan } = await createApprovedFixture(app);
    const sequenceId = plan.structure.content.sequences[0].id as string;
    const selected = plan.passages.find((item: { content: { sequenceId: string } }) => item.content.sequenceId === sequenceId);
    if (!selected) throw new Error("Expected a passage in the selected sequence");
    const saved = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
      payload: { proseMarkdown: "Proposal changes must not erase this prose.", authorNote: "" },
    })).json();
    const generation = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans`, payload: {
        scope: { kind: "sequence", sequenceId },
        providerId: provider.id, modelId: "deterministic-fixture-material-purpose-v1",
      },
    })).json();
    materialUnits.push(...generation.units.map((unit: { id: string }) => unit.id));
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans/${generation.id}/authorize`,
      payload: { fingerprint: generation.fingerprint },
    });
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${generation.jobId}/start`,
    });
    expect((await waitForGeneration(app, projectId, generation.jobId)).status).toBe("completed");
    const proposal = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${generation.jobId}/proposals`,
    })).json();
    expect(proposal.groups.flatMap((group: { operations: Array<{ entityId: string; fieldDiffs: Array<{ field: string }> }> }) => group.operations)
      .find((operation: { entityId: string }) => operation.entityId === selected.entityId)?.fieldDiffs)
      .toEqual(expect.arrayContaining([expect.objectContaining({ field: "purpose" })]));
    const groupIds = proposal.groups.map((group: { id: string }) => group.id);
    const preview = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/proposals/${proposal.id}/preview`,
      payload: { groupIds },
    })).json();
    expect(preview.valid).toBe(true);
    const applied = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/proposals/${proposal.id}/apply`,
      payload: { groupIds, previewFingerprint: preview.previewFingerprint },
    });
    expect(applied.statusCode).toBe(201);
    const state = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
    })).json();
    expect(state.head.current).toMatchObject({ id: saved.draft.id, stale: true, proseMarkdown: saved.draft.proseMarkdown });
    expect(state.head.current.staleReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "passage-plan-material-change", changedFields: ["purpose"] }),
    ]));
    await app.close();
  }, 20_000);

  it("previews and runs only bounded lifecycle jobs while ignoring browser attempts to raise limits", async () => {
    const app = buildApp();
    const { projectId, plan, snapshot } = await createApprovedFixture(app);
    const passageIds = plan.passages.map((item: { entityId: string }) => item.entityId);
    const request = {
      scope: { kind: "passages", passageIds }, providerId: "offline-only", modelId: "no-prose-v1",
      policy: { maxPassagesPerUnit: 1000, maxAttemptsPerUnit: 1000, maxOutputTokensPerUnit: 999_999 },
    };
    const preview = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/preview`, payload: request,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      snapshotId: snapshot.id,
      policy: { maxPassagesPerUnit: 8, maxAttemptsPerUnit: 3, maxOutputTokensPerUnit: 12_000 },
    });
    expect(preview.json().units.length).toBeGreaterThan(0);
    expect(preview.json().units.every((unit: { contextDiagnostics: { status: string } }) =>
      unit.contextDiagnostics.status === "not-built")).toBe(true);
    const created = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans`, payload: request,
    })).json();
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/${created.id}/authorize`,
      payload: { fingerprint: created.fingerprint },
    })).statusCode).toBe(200);
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start` });
    for (const unit of created.units as Array<{ id: string }>) {
      const attempt = (await app.inject({
        method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/units/${unit.id}/start`,
      })).json();
      await app.inject({
        method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/units/${unit.id}/complete`,
        payload: { attemptId: attempt.attemptId },
      });
    }
    const finished = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/finalize`,
    })).json();
    expect(finished.status).toBe("completed");
    expect(finished.units[0].usage).toMatchObject({ syntheticLifecycleOnly: true, outputTokens: 0 });
    expect((await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/summary`,
    })).json().currentDraftCount).toBe(0);
    await app.close();
  });

  it("recovers an interrupted lifecycle job after reopening without creating prose", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-drafting-api-recovery-"));
    directories.push(directory);
    const databasePath = join(directory, "story.sqlite");
    const app = buildApp({ databasePath });
    const { projectId, plan } = await createApprovedFixture(app);
    const created = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans`,
      payload: { scope: { kind: "passages", passageIds: [plan.passages[0].entityId] } },
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/${created.id}/authorize`,
      payload: { fingerprint: created.fingerprint },
    });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start` });
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/units/${created.units[0].id}/start`,
    });
    await app.close();

    const reopened = buildApp({ databasePath });
    const recovered = (await reopened.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}`,
    })).json();
    expect(recovered.status).toBe("failed");
    expect(recovered.units[0]).toMatchObject({ status: "failed", attemptNumber: 1 });
    expect((await reopened.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/summary`,
    })).json().currentDraftCount).toBe(0);
    await reopened.close();
  });
});
