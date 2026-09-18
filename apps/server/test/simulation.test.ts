import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@story-to-cyoa/persistence";
import { stableFingerprint } from "@story-to-cyoa/runtime";
import { buildApp } from "../src/app.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });

async function approvedProject(databasePath?: string) {
  const app = buildApp({ databasePath });
  apps.push(app);
  const created = (await app.inject({
    method: "POST", url: "/api/long-form/projects", payload: { name: "Simulation kernel" },
  })).json();
  const projectId = created.project.id as string;
  await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`, payload: { versionId: created.brief.id },
  });
  await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`, payload: { versionId: created.creativeDirection.id },
  });
  for (const artifactId of ["bible", "routes", "endings"] as const) {
    const generated = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}`,
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}/approve`,
      payload: { versionId: generated[artifactId].id },
    });
  }
  const mechanics = (await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/mechanics`,
  })).json();
  const savedMechanics = (await app.inject({
    method: "PUT", url: `/api/long-form/projects/${projectId}/mechanics`, payload: {
      ...mechanics.mechanics.content,
      choiceEffectPlans: [{
        id: "effect-simulation", label: "Simulation effects", sourceDecisionIds: ["decision-route-selection"],
        mechanicKeys: mechanics.mechanics.content.visibleStats.map((item: { key: string }) => item.key),
        effectGuidance: ["Exercise deterministic state."],
      }],
    },
  })).json();
  await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`,
    payload: { versionId: savedMechanics.mechanics.id },
  });
  const plan = (await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan`,
  })).json();
  const snapshot = (await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots`,
  })).json();
  expect((await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`, payload: { snapshotId: snapshot.id },
  })).statusCode).toBe(201);
  return { app, projectId, plan, snapshot };
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
  throw new Error("No deterministic ending path in fixture");
}

describe("Foundation 5A simulation API", () => {
  it("captures exact approved input, runs and reopens provider-free evidence, and ignores later mutable heads", async () => {
    const { app, projectId, plan, snapshot } = await approvedProject();
    const firstPassageId = plan.structure.content.startPassageId as string;
    const candidate = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${firstPassageId}`,
      payload: { proseMarkdown: "Exact accepted prose identity.", authorNote: "Simulation fixture" },
    })).json().draft;
    const preview = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/acceptance/preview`,
      payload: { selections: [{ passageId: firstPassageId, candidateDraftVersionId: candidate.id }] },
    })).json();
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/acceptance/apply`,
      payload: { selections: preview.selections, previewFingerprint: preview.fingerprint },
    })).statusCode).toBe(201);

    const createdInput = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/simulation/inputs`,
    });
    expect(createdInput.statusCode).toBe(201);
    const inputVersion = createdInput.json();
    expect(inputVersion.content).toMatchObject({
      schemaVersion: 1,
      projectId,
      snapshotId: snapshot.id,
      structureVersionId: snapshot.structureVersionId,
      fingerprint: expect.stringMatching(/^[0-9a-f]{32}$/),
      runtimeFingerprint: expect.stringMatching(/^[0-9a-f]{32}$/),
      acceptedDraftVersions: [{ entityId: firstPassageId, versionId: expect.any(String) }],
    });
    expect(inputVersion.content.passageVersions).toHaveLength(plan.passages.length);
    expect(inputVersion.content.choiceVersions).toHaveLength(plan.choices.length);

    const deterministic = exactPath(plan);
    const runResponse = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/simulation/runs`, payload: {
        inputArtifactVersionId: inputVersion.id,
        choiceIds: deterministic.choiceIds,
        expectedEndingId: deterministic.endingId,
      },
    });
    expect(runResponse.statusCode).toBe(201);
    const runVersion = runResponse.json();
    expect(runVersion.content).toMatchObject({
      inputArtifactVersionId: inputVersion.id,
      inputFingerprint: inputVersion.content.fingerprint,
      runtimeFingerprint: inputVersion.content.runtimeFingerprint,
      trace: {
        simulationInputFingerprint: inputVersion.content.fingerprint,
        visitedPassageIds: expect.any(Array),
        selectedChoiceIds: deterministic.choiceIds,
        result: { kind: "completed-ending", endingId: deterministic.endingId },
        findings: [],
      },
    });
    expect(runVersion.content.trace.visitedPassageIds).toHaveLength(deterministic.choiceIds.length + 1);

    const listed = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/simulation/runs`,
    })).json();
    expect(listed.items[0]).toMatchObject({
      versionId: runVersion.id, traceFingerprint: runVersion.content.trace.fingerprint,
      result: { kind: "completed-ending" }, stepCount: deterministic.choiceIds.length, findingCount: 0,
    });
    const reopenedBefore = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/simulation/runs/${runVersion.id}`,
    })).json();

    const firstPassage = plan.passages.find((item: { entityId: string }) => item.entityId === firstPassageId).content;
    expect((await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/passage-plan/entities/passage/${firstPassageId}`,
      payload: { ...firstPassage, title: "Cosmetic title after historical input" },
    })).statusCode).toBe(201);
    const repeated = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/simulation/runs`, payload: {
        inputArtifactVersionId: inputVersion.id,
        choiceIds: deterministic.choiceIds,
        expectedEndingId: deterministic.endingId,
      },
    });
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json().content.trace).toEqual(runVersion.content.trace);
    const reopenedAfter = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/simulation/runs/${runVersion.id}`,
    })).json();
    expect(reopenedAfter).toEqual(reopenedBefore);
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/simulation/inputs`,
    })).statusCode).toBe(409);

    const nextSnapshot = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots`,
    })).json();
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`, payload: { snapshotId: nextSnapshot.id },
    })).statusCode).toBe(201);
    const nextInput = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/simulation/inputs`,
    })).json();
    expect(nextInput.content.fingerprint).not.toBe(inputVersion.content.fingerprint);
    expect(nextInput.content.runtimeFingerprint).toBe(inputVersion.content.runtimeFingerprint);
  });

  it("rejects cross-project input linkage and malformed stable-ID paths", async () => {
    const first = await approvedProject();
    const inputVersion = (await first.app.inject({
      method: "POST", url: `/api/long-form/projects/${first.projectId}/simulation/inputs`,
    })).json();
    const secondCreated = (await first.app.inject({
      method: "POST", url: "/api/long-form/projects", payload: { name: "Other project" },
    })).json();
    const crossProject = await first.app.inject({
      method: "POST", url: `/api/long-form/projects/${secondCreated.project.id}/simulation/runs`,
      payload: { inputArtifactVersionId: inputVersion.id, choiceIds: [] },
    });
    expect(crossProject.statusCode).toBe(404);
    expect(crossProject.json().code).toBe("simulation_input_not_found");
    const malformed = await first.app.inject({
      method: "POST", url: `/api/long-form/projects/${first.projectId}/simulation/runs`,
      payload: { inputArtifactVersionId: inputVersion.id, choiceIds: [2] },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().code).toBe("simulation_path_invalid");
  });

  it("reopens immutable simulation input and completed trace evidence after SQLite restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-simulation-evidence-"));
    const databasePath = join(directory, "story.sqlite");
    try {
      const fixture = await approvedProject(databasePath);
      const inputVersion = (await fixture.app.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/inputs`,
      })).json();
      const deterministic = exactPath(fixture.plan);
      const runVersion = (await fixture.app.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/runs`, payload: {
          inputArtifactVersionId: inputVersion.id,
          choiceIds: deterministic.choiceIds,
          expectedEndingId: deterministic.endingId,
        },
      })).json();
      const expectedEvidence = runVersion.content;
      apps.splice(apps.indexOf(fixture.app), 1);
      await fixture.app.close();

      const reopened = buildApp({ databasePath });
      apps.push(reopened);
      const evidence = await reopened.inject({
        method: "GET", url: `/api/long-form/projects/${fixture.projectId}/simulation/runs/${runVersion.id}`,
      });
      expect(evidence.statusCode).toBe(200);
      expect(evidence.json().content).toEqual(expectedEvidence);
      const replay = await reopened.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/runs`, payload: {
          inputArtifactVersionId: inputVersion.id,
          choiceIds: deterministic.choiceIds,
          expectedEndingId: deterministic.endingId,
        },
      });
      expect(replay.statusCode).toBe(201);
      expect(replay.json().content.trace).toEqual(expectedEvidence.trace);
      apps.splice(apps.indexOf(reopened), 1);
      await reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects directly corrupted persisted snapshot lineage without creating run evidence", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-simulation-corrupt-"));
    const databasePath = join(directory, "story.sqlite");
    try {
      const fixture = await approvedProject(databasePath);
      const inputVersion = (await fixture.app.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/inputs`,
      })).json();
      const database = openDatabase(databasePath);
      const row = database.prepare("SELECT content_json FROM artifact_versions WHERE id = ?").get(inputVersion.id) as { content_json: string };
      const corrupted = JSON.parse(row.content_json) as Record<string, unknown>;
      corrupted.snapshotId = "snapshot-corrupt-lineage";
      const { id: _id, runtimeFingerprint: _runtime, fingerprint: _fingerprint, ...identity } = corrupted;
      corrupted.fingerprint = stableFingerprint(identity);
      corrupted.id = `simin_${String(corrupted.fingerprint)}`;
      database.prepare("UPDATE artifact_versions SET content_json = ? WHERE id = ?")
        .run(JSON.stringify(corrupted), inputVersion.id);
      database.close();

      const rejected = await fixture.app.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/runs`, payload: {
          inputArtifactVersionId: inputVersion.id, choiceIds: [],
        },
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().code).toBe("simulation_snapshot_lineage_invalid");
      expect((await fixture.app.inject({
        method: "GET", url: `/api/long-form/projects/${fixture.projectId}/simulation/runs`,
      })).json().items).toEqual([]);
      apps.splice(apps.indexOf(fixture.app), 1);
      await fixture.app.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("cascades persisted simulation inputs and runs when their owning project is deleted", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-simulation-cascade-"));
    const databasePath = join(directory, "story.sqlite");
    try {
      const fixture = await approvedProject(databasePath);
      const inputVersion = (await fixture.app.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/inputs`,
      })).json();
      const deterministic = exactPath(fixture.plan);
      expect((await fixture.app.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/runs`, payload: {
          inputArtifactVersionId: inputVersion.id, choiceIds: deterministic.choiceIds,
        },
      })).statusCode).toBe(201);
      apps.splice(apps.indexOf(fixture.app), 1);
      await fixture.app.close();

      const database = openDatabase(databasePath);
      expect((database.prepare("SELECT COUNT(*) AS count FROM artifact_versions WHERE project_id = ? AND artifact_id IN (?, ?)")
        .get(fixture.projectId, "simulation-inputs", "simulation-runs") as { count: number }).count).toBe(2);
      expect(() => database.prepare("DELETE FROM projects WHERE id = ?").run(fixture.projectId)).not.toThrow();
      expect((database.prepare("SELECT COUNT(*) AS count FROM artifact_versions WHERE project_id = ?")
        .get(fixture.projectId) as { count: number }).count).toBe(0);
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an oversized simulation request at the service boundary without persisting evidence", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-simulation-request-bound-"));
    const databasePath = join(directory, "story.sqlite");
    try {
      const fixture = await approvedProject(databasePath);
      const inputVersion = (await fixture.app.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/inputs`,
      })).json();
      const database = openDatabase(databasePath);
      const row = database.prepare("SELECT content_json FROM artifact_versions WHERE id = ?").get(inputVersion.id) as { content_json: string };
      const bounded = JSON.parse(row.content_json) as Record<string, unknown> & { policy: { maxTraceBytes: number } };
      bounded.policy = { ...(bounded.policy as object), maxTraceBytes: 2_000 } as typeof bounded.policy;
      const { id: _id, runtimeFingerprint: _runtime, fingerprint: _fingerprint, ...identity } = bounded;
      bounded.fingerprint = stableFingerprint(identity);
      bounded.id = `simin_${String(bounded.fingerprint)}`;
      database.prepare("UPDATE artifact_versions SET content_json = ? WHERE id = ?")
        .run(JSON.stringify(bounded), inputVersion.id);
      database.close();

      const rejected = await fixture.app.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/runs`, payload: {
          inputArtifactVersionId: inputVersion.id,
          choiceIds: [],
          expectedState: { resources: { ["oversized-" + "x".repeat(4_000)]: 1 } },
        },
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().code).toBe("simulation_trace_too_large");
      expect((await fixture.app.inject({
        method: "GET", url: `/api/long-form/projects/${fixture.projectId}/simulation/runs`,
      })).json().items).toEqual([]);
      apps.splice(apps.indexOf(fixture.app), 1);
      await fixture.app.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
