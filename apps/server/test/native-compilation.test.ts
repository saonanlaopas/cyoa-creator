import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@story-to-cyoa/persistence";
import {
  NATIVE_BUNDLE_LIMITS,
  loadNativeGame,
  runDeterministicPath,
  serializedBytes,
} from "@story-to-cyoa/runtime";
import { buildApp } from "../src/app.js";

const apps: ReturnType<typeof buildApp>[] = [];
const temporaryDirectories: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

interface SeedOptions {
  databasePath?: string;
  passageCount?: number;
  acceptDrafts?: boolean;
}

async function seedApprovedProject(options: SeedOptions = {}) {
  const app = buildApp({ databasePath: options.databasePath });
  apps.push(app);
  const created = (await app.inject({
    method: "POST", url: "/api/long-form/projects", payload: { name: "Native compilation fixture" },
  })).json();
  const projectId = created.project.id as string;
  await ok(app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`, payload: { versionId: created.brief.id },
  }));
  const artifacts: Record<string, any> = { brief: created.brief };
  for (const artifactId of ["bible", "routes", "endings"] as const) {
    const generated = (await ok(app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}`,
    }))).json();
    artifacts[artifactId] = generated[artifactId];
    await ok(app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}/approve`,
      payload: { versionId: generated[artifactId].id },
    }));
  }
  const mechanics = (await ok(app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/mechanics`,
  }))).json();
  const savedMechanics = (await ok(app.inject({
    method: "PUT", url: `/api/long-form/projects/${projectId}/mechanics`, payload: {
      ...mechanics.mechanics.content,
      choiceEffectPlans: [{
        id: "effect-native", label: "Native runtime effects", sourceDecisionIds: ["decision-route-selection"],
        mechanicKeys: mechanics.mechanics.content.visibleStats.map((item: { key: string }) => item.key),
        effectGuidance: ["Exercise the accepted runtime semantics."],
      }],
    },
  }))).json();
  artifacts.mechanics = savedMechanics.mechanics;
  await ok(app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`,
    payload: { versionId: savedMechanics.mechanics.id },
  }));
  await ok(app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan` }));
  if (options.passageCount) {
    await replaceWithLinearPlan(app, projectId, artifacts.routes.content, artifacts.endings.content, options.passageCount);
  }
  const snapshot = (await ok(app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots`,
  }))).json();
  await ok(app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`, payload: { snapshotId: snapshot.id },
  }));
  const plan = (await ok(app.inject({
    method: "GET", url: `/api/long-form/projects/${projectId}/passage-plan`,
  }))).json();
  const proseByPassage = new Map<string, string>();
  const candidates: Array<{ passageId: string; candidateDraftVersionId: string }> = [];
  if (options.acceptDrafts !== false) {
    for (const passage of plan.passages as Array<{ entityId: string }>) {
      const prose = passage.entityId === plan.structure.content.startPassageId
        ? `  Exact accepted prose for ${passage.entityId}.\r\n\n*Preserve Markdown and whitespace.*  `
        : `Exact accepted prose for ${passage.entityId}.`;
      proseByPassage.set(passage.entityId, prose);
      const saved = (await ok(app.inject({
        method: "PUT",
        url: `/api/long-form/projects/${projectId}/drafts/passages/${passage.entityId}`,
        payload: {
          proseMarkdown: prose,
          authorNote: `AUTHOR_ONLY ${passage.entityId} C:\\private\\draft.sqlite OPENROUTER_API_KEY`,
        },
      }))).json();
      candidates.push({ passageId: passage.entityId, candidateDraftVersionId: saved.draft.id });
    }
    const preview = (await ok(app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/acceptance/preview`,
      payload: { selections: candidates },
    }))).json();
    expect(preview.valid).toBe(true);
    await ok(app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/acceptance/apply`,
      payload: { selections: candidates, previewFingerprint: preview.fingerprint },
    }));
  }
  return { app, projectId, plan, snapshot, artifacts, proseByPassage, candidates };
}

async function replaceWithLinearPlan(
  app: ReturnType<typeof buildApp>,
  projectId: string,
  routes: { routes: Array<{ id: string }> },
  endings: { endings: Array<{ id: string; routeId: string }> },
  passageCount: number,
) {
  const routeId = routes.routes[0]!.id;
  const endingId = endings.endings.find((item) => item.routeId === routeId)!.id;
  const passageIds = Array.from({ length: passageCount }, (_, index) => `passage-${String(index).padStart(3, "0")}`);
  const passages = passageIds.map((passageId, index) => ({
    id: passageId,
    sequenceId: "sequence-main",
    title: `Passage ${index}`,
    kind: index === passageCount - 1 ? "epilogue" : "scene",
    purpose: `Plan beat ${index}`,
    summary: "",
    wordTarget: 500,
    routeIds: [routeId], tags: [], characterIds: [], relationshipIds: [], locationIds: [],
    requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [], preservedDifferenceIds: [],
    choiceIds: index === passageCount - 1 ? [] : [`choice-${String(index).padStart(3, "0")}`],
    terminal: index === passageCount - 1,
    endingId: index === passageCount - 1 ? endingId : null,
    draftingNotes: [], unresolvedQuestions: [], planningStatus: "planned", position: index,
  }));
  const choices = passageIds.slice(0, -1).map((passageId, index) => ({
    id: `choice-${String(index).padStart(3, "0")}`,
    sourcePassageId: passageId,
    label: `Continue ${index}`,
    destinationPassageId: passageIds[index + 1],
    narrativeIntent: "", consequencePreview: "", condition: null,
    unavailableBehavior: "disabled", unavailableExplanation: "", effects: [], sourceDecisionIds: [], position: 0,
  }));
  await ok(app.inject({
    method: "PUT", url: `/api/long-form/projects/${projectId}/passage-plan`, payload: {
      schemaVersion: 1,
      structure: {
        schemaVersion: 1,
        title: "Native linear fixture",
        projectWordTarget: passageCount * 500,
        typicalPathWordTarget: passageCount * 500,
        startPassageId: passageIds[0],
        acts: [{
          id: "act-main", label: "Main act", purpose: "", summary: "", wordTarget: passageCount * 500,
          routeIds: [routeId], sequenceIds: ["sequence-main"], position: 0,
        }],
        sequences: [{
          id: "sequence-main", actId: "act-main", label: "Main sequence", purpose: "", summary: "",
          wordTarget: passageCount * 500, routeIds: [routeId], passageIds, entryGoals: [], exitGoals: [],
          requiredDecisionIds: [], endingHookIds: [], position: 0, planningStatus: "planned",
        }],
        characterAvailability: [],
      },
      passages, choices, threads: [],
    },
  }));
}

function exactPath(plan: {
  structure: { content: { startPassageId: string } };
  passages: Array<{ entityId: string; content: { terminal: boolean; endingId: string | null; choiceIds: string[] } }>;
  choices: Array<{ entityId: string; content: { destinationPassageId: string } }>;
}) {
  const passages = new Map(plan.passages.map((item) => [item.entityId, item.content]));
  const choices = new Map(plan.choices.map((item) => [item.entityId, item.content]));
  const queue = [{ passageId: plan.structure.content.startPassageId, choiceIds: [] as string[] }];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current.passageId)) continue;
    seen.add(current.passageId);
    const passage = passages.get(current.passageId)!;
    if (passage.terminal) return { choiceIds: current.choiceIds, endingId: passage.endingId };
    for (const choiceId of passage.choiceIds) {
      const choice = choices.get(choiceId);
      if (choice) queue.push({ passageId: choice.destinationPassageId, choiceIds: [...current.choiceIds, choiceId] });
    }
  }
  throw new Error("Fixture has no ending path");
}

async function ok(responsePromise: ReturnType<ReturnType<typeof buildApp>["inject"]>) {
  const response = await responsePromise;
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response;
}

function temporaryDatabasePath(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `cyoa-native-${label}-`));
  temporaryDirectories.push(directory);
  return join(directory, "story.sqlite");
}

function mutateArtifact(
  databasePath: string,
  versionId: string,
  mutate: (content: Record<string, any>) => void,
): void {
  const database = openDatabase(databasePath);
  try {
    const row = database.prepare("SELECT content_json FROM artifact_versions WHERE id = ?").get(versionId) as {
      content_json: string;
    };
    const content = JSON.parse(row.content_json) as Record<string, any>;
    mutate(content);
    database.prepare("UPDATE artifact_versions SET content_json = ? WHERE id = ?")
      .run(JSON.stringify(content), versionId);
  } finally {
    database.close();
  }
}

async function expectPlanningBlocker(
  artifactId: "routes" | "endings" | "mechanics",
  expectedCodes: string[],
  mutate: (content: Record<string, any>) => void,
) {
  const databasePath = temporaryDatabasePath(artifactId);
  const fixture = await seedApprovedProject({ databasePath });
  mutateArtifact(databasePath, fixture.artifacts[artifactId].id, mutate);
  const first = (await ok(fixture.app.inject({
    method: "GET", url: `/api/long-form/projects/${fixture.projectId}/publication/readiness`,
  }))).json();
  const second = (await ok(fixture.app.inject({
    method: "GET", url: `/api/long-form/projects/${fixture.projectId}/publication/readiness`,
  }))).json();
  expect(first.ready).toBe(false);
  for (const code of expectedCodes) expect(first.blockers.map((item: { code: string }) => item.code)).toContain(code);
  expect(second.blockers).toEqual(first.blockers);
  expect(second.blockers.map((item: { fingerprint: string }) => item.fingerprint))
    .toEqual(first.blockers.map((item: { fingerprint: string }) => item.fingerprint));
  expect((await fixture.app.inject({
    method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/compile`, payload: {},
  })).statusCode).toBe(409);
  expect((await ok(fixture.app.inject({
    method: "GET", url: `/api/long-form/projects/${fixture.projectId}/publication/builds`,
  }))).json().items).toEqual([]);
}

describe("Foundation 7A native compilation API", () => {
  it("reports exact readiness, compiles deterministically, excludes candidates and author-only data, and preserves lifecycle-equivalent prose", async () => {
    const fixture = await seedApprovedProject();
    const readiness = (await ok(fixture.app.inject({
      method: "GET", url: `/api/long-form/projects/${fixture.projectId}/publication/readiness`,
    }))).json();
    expect(readiness).toMatchObject({
      ready: true,
      snapshotId: fixture.snapshot.id,
      passageCount: fixture.plan.passages.length,
      choiceCount: fixture.plan.choices.length,
      acceptedDraftCount: fixture.plan.passages.length,
      sourceInputFingerprint: expect.stringMatching(/^[0-9a-f]{32}$/),
      blockers: [],
      compiler: { version: "foundation-7a-v1" },
      runtimeContract: { version: "foundation-5a-v1" },
      bundleContract: { schemaId: "cyoa.native-game-bundle", schemaVersion: 1 },
    });
    expect(readiness.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "publication.planning.ending.readiness.placeholder",
        severity: "warning",
        acknowledged: false,
      }),
    ]));
    expect(readiness.blockers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "publication.planning.ending.readiness.placeholder" }),
    ]));

    const first = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/compile`, payload: {},
    }))).json();
    const second = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/compile`, payload: {},
    }))).json();
    expect(second.bundle).toEqual(first.bundle);
    expect(second.playerConfig).toEqual(first.playerConfig);
    expect(first.playerConfig).toMatchObject({
      gameId: first.bundle.gameId,
      autosaveEnabled: true,
      manualSlotLimit: 20,
      rewindPolicy: { kind: "previous-step" },
    });
    expect(first.playerConfig.visibleMechanics).toEqual(expect.arrayContaining(
      fixture.artifacts.mechanics.content.visibleStats.map((item: { key: string; label: string }) => ({
        key: item.key, category: "stat", label: item.label,
      })),
    ));
    expect(first.playerConfig.visibleMechanics.every((item: { category: string }) => item.category === "stat")).toBe(true);
    expect(second.bundle.bundleFingerprint).toBe(first.bundle.bundleFingerprint);
    expect(second.bundle.source.inputFingerprint).toBe(first.bundle.source.inputFingerprint);
    const firstPassageId = fixture.plan.structure.content.startPassageId as string;
    expect(first.bundle.passages.find((item: { id: string }) => item.id === firstPassageId).proseMarkdown)
      .toBe(fixture.proseByPassage.get(firstPassageId));
    expect(first.bundle.choices[0].text).toBe(fixture.plan.choices.find(
      (item: { entityId: string }) => item.entityId === first.bundle.choices[0].id,
    ).content.label);
    const serialized = JSON.stringify(first.bundle);
    expect(serialized).not.toContain("AUTHOR_ONLY");
    expect(serialized).not.toContain("OPENROUTER_API_KEY");
    expect(serialized).not.toContain("C:\\\\private");
    expect(serialized).not.toContain("repairPlan");
    expect(serialized).not.toContain("narrative");

    const candidate = (await ok(fixture.app.inject({
      method: "PUT", url: `/api/long-form/projects/${fixture.projectId}/drafts/passages/${firstPassageId}`,
      payload: { proseMarkdown: "NEWER CANDIDATE MUST NOT LEAK", authorNote: "candidate only" },
    }))).json().draft;
    const afterCandidate = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/compile`, payload: {},
    }))).json();
    expect(JSON.stringify(afterCandidate.bundle)).not.toContain(candidate.proseMarkdown);
    expect(afterCandidate.bundle.bundleFingerprint).toBe(first.bundle.bundleFingerprint);

    const acceptedState = (await ok(fixture.app.inject({
      method: "GET", url: `/api/long-form/projects/${fixture.projectId}/drafts/passages/${firstPassageId}`,
    }))).json();
    const reviewed = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/drafts/passages/${firstPassageId}/transition`,
      payload: { versionId: acceptedState.head.accepted.id, status: "reviewed" },
    }))).json().draft;
    await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/drafts/passages/${firstPassageId}/transition`,
      payload: { versionId: reviewed.id, status: "locked" },
    }));
    const afterLock = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/compile`, payload: {},
    }))).json();
    expect(afterLock.bundle.bundleFingerprint).toBe(first.bundle.bundleFingerprint);
    expect(afterLock.playerConfig.configFingerprint).toBe(first.playerConfig.configFingerprint);
    expect(afterLock.bundle.source.inputFingerprint).not.toBe(first.bundle.source.inputFingerprint);
    expect(afterLock.bundle.passages.find((item: { id: string }) => item.id === firstPassageId).proseMarkdown)
      .toBe(fixture.proseByPassage.get(firstPassageId));
  });

  it("matches Foundation 5A runtime transitions, state, routes, facts, and ending results", async () => {
    const fixture = await seedApprovedProject();
    const simulationInput = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/inputs`,
    }))).json();
    const path = exactPath(fixture.plan);
    const simulationRun = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/runs`, payload: {
        inputArtifactVersionId: simulationInput.id,
        choiceIds: path.choiceIds,
        expectedEndingId: path.endingId,
      },
    }))).json();
    const compiled = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/compile`, payload: {},
    }))).json();
    const native = loadNativeGame(compiled.bundle);
    expect(native.runtime.fingerprint).toBe(simulationInput.content.runtimeFingerprint);
    const trace = runDeterministicPath(native.runtime, simulationInput.content.fingerprint, {
      choiceIds: path.choiceIds,
      expectedEndingId: path.endingId,
      policy: simulationInput.content.policy,
    });
    expect(trace).toEqual(simulationRun.content.trace);
  });

  it("compiles captured immutable history after newer approval and gives refreshed current meaning a new source identity", async () => {
    const fixture = await seedApprovedProject();
    const captured = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/inputs`,
    }))).json();
    const firstPassage = fixture.plan.passages[0];
    await ok(fixture.app.inject({
      method: "PUT", url: `/api/long-form/projects/${fixture.projectId}/passage-plan/entities/passage/${firstPassage.entityId}`,
      payload: { ...firstPassage.content, purpose: "New approved purpose after immutable capture" },
    }));
    const newerSnapshot = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/passage-plan/snapshots`,
    }))).json();
    await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/passage-plan/approve`, payload: { snapshotId: newerSnapshot.id },
    }));
    const historical = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/compile`,
      payload: { inputArtifactVersionId: captured.id },
    }))).json();
    expect(historical.bundle.source.inputFingerprint).toBe(captured.content.sourceInputFingerprint);
    expect(historical.bundle.source.snapshotId).toBe(fixture.snapshot.id);
    const blockedCurrent = (await ok(fixture.app.inject({
      method: "GET", url: `/api/long-form/projects/${fixture.projectId}/publication/readiness`,
    }))).json();
    expect(blockedCurrent.ready).toBe(false);
    expect(blockedCurrent.blockers.map((item: { code: string }) => item.code)).toContain("publication.accepted-prose-stale");

    const replacement = (await ok(fixture.app.inject({
      method: "PUT", url: `/api/long-form/projects/${fixture.projectId}/drafts/passages/${firstPassage.entityId}`,
      payload: { proseMarkdown: "Replacement accepted prose for the newly approved passage.", authorNote: "" },
    }))).json().draft;
    const preview = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/drafts/acceptance/preview`,
      payload: { selections: [{ passageId: firstPassage.entityId, candidateDraftVersionId: replacement.id }] },
    }))).json();
    await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/drafts/acceptance/apply`,
      payload: { selections: preview.selections, previewFingerprint: preview.fingerprint },
    }));
    const current = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/compile`, payload: {},
    }))).json();
    expect(current.bundle.source.inputFingerprint).not.toBe(historical.bundle.source.inputFingerprint);
    expect(current.bundle.bundleFingerprint).not.toBe(historical.bundle.bundleFingerprint);
    expect(current.bundle.source.snapshotId).toBe(newerSnapshot.id);
  });

  it("changes source and gameplay bundle identities when approved mechanic meaning changes", async () => {
    const fixture = await seedApprovedProject();
    const first = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/compile`, payload: {},
    }))).json();
    const mechanics = fixture.artifacts.mechanics.content;
    const changedInitial = mechanics.visibleStats[0].initial + 1;
    const saved = (await ok(fixture.app.inject({
      method: "PUT", url: `/api/long-form/projects/${fixture.projectId}/mechanics`, payload: {
        ...mechanics,
        visibleStats: mechanics.visibleStats.map((item: { key: string }) => item.key === mechanics.visibleStats[0].key
          ? { ...item, initial: changedInitial }
          : item),
      },
    }))).json();
    await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/mechanics/approve`,
      payload: { versionId: saved.mechanics.id },
    }));
    const snapshot = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/passage-plan/snapshots`,
    }))).json();
    await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/passage-plan/approve`,
      payload: { snapshotId: snapshot.id },
    }));
    const selections: Array<{ passageId: string; candidateDraftVersionId: string }> = [];
    for (const passage of fixture.plan.passages as Array<{ entityId: string }>) {
      const candidate = (await ok(fixture.app.inject({
        method: "PUT", url: `/api/long-form/projects/${fixture.projectId}/drafts/passages/${passage.entityId}`,
        payload: { proseMarkdown: fixture.proseByPassage.get(passage.entityId), authorNote: "" },
      }))).json().draft;
      selections.push({ passageId: passage.entityId, candidateDraftVersionId: candidate.id });
    }
    const preview = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/drafts/acceptance/preview`,
      payload: { selections },
    }))).json();
    await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/drafts/acceptance/apply`,
      payload: { selections, previewFingerprint: preview.fingerprint },
    }));
    const second = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/compile`, payload: {},
    }))).json();
    expect(second.bundle.source.inputFingerprint).not.toBe(first.bundle.source.inputFingerprint);
    expect(second.bundle.bundleFingerprint).not.toBe(first.bundle.bundleFingerprint);
    expect(second.bundle.initialState.stats[mechanics.visibleStats[0].key]).toBe(changedInitial);
  });

  it("blocks missing and stale accepted prose without creating build metadata", async () => {
    const missing = await seedApprovedProject({ acceptDrafts: false });
    const readiness = (await ok(missing.app.inject({
      method: "GET", url: `/api/long-form/projects/${missing.projectId}/publication/readiness`,
    }))).json();
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.filter((item: { code: string }) => item.code === "publication.accepted-prose-missing"))
      .toHaveLength(missing.plan.passages.length);
    const rejectedMissing = await missing.app.inject({
      method: "POST", url: `/api/long-form/projects/${missing.projectId}/publication/compile`, payload: {},
    });
    expect(rejectedMissing.statusCode).toBe(409);
    expect((await ok(missing.app.inject({
      method: "GET", url: `/api/long-form/projects/${missing.projectId}/publication/builds`,
    }))).json().items).toEqual([]);

    const stale = await seedApprovedProject();
    const passage = stale.plan.passages[0];
    await ok(stale.app.inject({
      method: "PUT", url: `/api/long-form/projects/${stale.projectId}/passage-plan/entities/passage/${passage.entityId}`,
      payload: { ...passage.content, wordTarget: passage.content.wordTarget + 25 },
    }));
    const nextSnapshot = (await ok(stale.app.inject({
      method: "POST", url: `/api/long-form/projects/${stale.projectId}/passage-plan/snapshots`,
    }))).json();
    await ok(stale.app.inject({
      method: "POST", url: `/api/long-form/projects/${stale.projectId}/passage-plan/approve`, payload: { snapshotId: nextSnapshot.id },
    }));
    const staleReadiness = (await ok(stale.app.inject({
      method: "GET", url: `/api/long-form/projects/${stale.projectId}/publication/readiness`,
    }))).json();
    expect(staleReadiness.ready).toBe(false);
    expect(staleReadiness.blockers.map((item: { code: string }) => item.code)).toContain("publication.accepted-prose-stale");
    expect((await stale.app.inject({
      method: "POST", url: `/api/long-form/projects/${stale.projectId}/publication/compile`, payload: {},
    })).statusCode).toBe(409);
  });

  it("blocks canonical route relationship and hook-ownership planning errors deterministically", async () => {
    await expectPlanningBlocker("routes", ["publication.planning.route.relationship.unknown"], (routes) => {
      routes.routes[0].relationshipArcs.push({
        relationshipId: "relationship-missing",
        trajectory: "Unknown relationship arc",
        keyMoments: [],
      });
    });
    await expectPlanningBlocker("routes", ["publication.planning.route.hook.owner-mismatch"], (routes) => {
      const foreignHook = routes.endingHooks.find((hook: { routeId: string }) => hook.routeId !== routes.routes[0].id);
      routes.routes[0].endingHookIds.push(foreignHook.id);
    });
  }, 15_000);

  it("blocks canonical ending character and relationship planning errors", async () => {
    await expectPlanningBlocker("endings", [
      "publication.planning.ending.character.unknown",
      "publication.planning.ending.relationship.unknown",
    ], (endings) => {
      endings.endings[0].characterOutcomes.push({
        characterId: "character-missing", outcome: "Unknown",
      });
      endings.endings[0].relationshipOutcomes.push({
        relationshipId: "relationship-missing", outcome: "Unknown",
      });
    });
  }, 15_000);

  it("blocks canonical mechanic relationship and gate-reference planning errors", async () => {
    await expectPlanningBlocker("mechanics", [
      "publication.planning.mechanic.relationship.unknown",
      "publication.planning.mechanic.gate.target-unknown",
    ], (mechanics) => {
      mechanics.relationships.push({
        id: "mechanic-relationship-missing", relationshipId: "relationship-missing",
        key: "relationship_missing", label: "Missing relationship", description: "",
        minimum: -5, maximum: 10, initial: 0, increaseSignals: [], decreaseSignals: [],
        bands: [{ id: "missing-neutral", minimum: 0, label: "Neutral", meaning: "" }],
      });
      mechanics.gates.push({
        id: "gate-missing-route", targetType: "route", targetId: "route-missing", logic: "all",
        conditions: [{ id: "condition-resolve", mechanicKey: "resolve", operator: "at-least", value: 1 }],
        rationale: "", fallback: "",
      });
    });
  }, 15_000);

  it("rejects corrupted persisted exact draft provenance before a bundle or build can exist", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-native-corrupt-"));
    const databasePath = join(directory, "story.sqlite");
    let fixture: Awaited<ReturnType<typeof seedApprovedProject>> | undefined;
    try {
      fixture = await seedApprovedProject({ databasePath });
      const captured = (await ok(fixture.app.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/inputs`,
      }))).json();
      const database = openDatabase(databasePath);
      try {
        const selected = captured.content.acceptedDrafts[0];
        // Simulate out-of-band disk corruption that bypasses the normal immutable-write boundary.
        database.exec("DROP TRIGGER passage_draft_versions_immutable_update");
        database.prepare("UPDATE passage_draft_versions SET prose_markdown = ? WHERE id = ?")
          .run("CORRUPTED AFTER CAPTURE", selected.versionId);
      } finally {
        database.close();
      }
      const rejected = await fixture.app.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/compile`,
        payload: { inputArtifactVersionId: captured.id },
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().code).toBe("native_input_draft_lineage_invalid");
      expect((await ok(fixture.app.inject({
        method: "GET", url: `/api/long-form/projects/${fixture.projectId}/publication/builds`,
      }))).json().items).toEqual([]);
    } finally {
      await fixture?.app.close();
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 30_000);

  it("adds only immutable publication metadata and leaves canonical authoring state byte-equivalent", async () => {
    const fixture = await seedApprovedProject();
    const beforePlan = (await ok(fixture.app.inject({
      method: "GET", url: `/api/long-form/projects/${fixture.projectId}/passage-plan`,
    }))).body;
    const beforeDrafts = await Promise.all(fixture.plan.passages.map(async (passage: { entityId: string }) =>
      (await ok(fixture.app.inject({
        method: "GET", url: `/api/long-form/projects/${fixture.projectId}/drafts/passages/${passage.entityId}`,
      }))).body));
    await ok(fixture.app.inject({
      method: "GET", url: `/api/long-form/projects/${fixture.projectId}/publication/readiness`,
    }));
    await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/compile`, payload: {},
    }));
    expect((await ok(fixture.app.inject({
      method: "GET", url: `/api/long-form/projects/${fixture.projectId}/passage-plan`,
    }))).body).toBe(beforePlan);
    const afterDrafts = await Promise.all(fixture.plan.passages.map(async (passage: { entityId: string }) =>
      (await ok(fixture.app.inject({
        method: "GET", url: `/api/long-form/projects/${fixture.projectId}/drafts/passages/${passage.entityId}`,
      }))).body));
    expect(afterDrafts).toEqual(beforeDrafts);
    const inputs = (await ok(fixture.app.inject({
      method: "GET", url: `/api/long-form/projects/${fixture.projectId}/publication/inputs`,
    }))).json().items;
    const builds = (await ok(fixture.app.inject({
      method: "GET", url: `/api/long-form/projects/${fixture.projectId}/publication/builds`,
    }))).json().items;
    expect(inputs).toHaveLength(1);
    expect(builds).toHaveLength(1);
    expect(builds[0].content).not.toHaveProperty("bundle");
  });

  it("compiles and loads the 300-passage accepted corpus deterministically within explicit bounds", async () => {
    const fixture = await seedApprovedProject({ passageCount: 300 });
    const first = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/compile`, payload: {},
    }))).json();
    const second = (await ok(fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/publication/compile`, payload: {},
    }))).json();
    expect(first.bundle.passages).toHaveLength(300);
    expect(new Set(first.bundle.passages.map((item: { id: string }) => item.id)).size).toBe(300);
    expect(first.bundle.choices).toHaveLength(299);
    expect(first.bundle.passages.every((item: { id: string; proseMarkdown: string }) =>
      item.proseMarkdown === fixture.proseByPassage.get(item.id))).toBe(true);
    expect(first.bundle.bundleFingerprint).toBe(second.bundle.bundleFingerprint);
    expect(first.bundle).toEqual(second.bundle);
    expect(serializedBytes(first.bundle)).toBeLessThan(NATIVE_BUNDLE_LIMITS.maximumSerializedBytes);
    const loaded = loadNativeGame(first.bundle);
    const path = exactPath(fixture.plan);
    const trace = runDeterministicPath(loaded.runtime, first.bundle.source.inputFingerprint, {
      choiceIds: path.choiceIds,
      expectedEndingId: path.endingId,
      policy: { version: "foundation-5a-v1", maxSteps: 500, maxVisitsPerPassage: 10, maxTraceBytes: 20_000_000 },
    });
    expect(trace.visitedPassageIds).toHaveLength(300);
    const serialized = JSON.stringify(first.bundle);
    expect(serialized).not.toContain("simulation-runs");
    expect(serialized).not.toContain("repair-proposal");
    expect(serialized).not.toContain("narrative-review");
  }, 30_000);
});
