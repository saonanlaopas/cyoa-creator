import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createNativePlayerSave, loadNativePlayerSave, nativePlayerView, presentCharacters, chooseNativePlayerSession, actNativePlayerWorld } from "@story-to-cyoa/runtime";
import { buildApp } from "../src/app.js";
import { authorDemo, finalChoice } from "../../../demos/last-harbor-signal/author.js";
import { playDemo } from "../../../demos/last-harbor-signal/play.js";

it("W6 authors a complete visual game through the real MCP SDK and replays both configurations, optional paths and next-day encounters", async () => {
  const projectId = randomUUID(), token = randomUUID().repeat(2), staging = await mkdtemp(join(tmpdir(), "w6-sdk-"));
  const generate = vi.fn(async () => { throw new Error("Paid/provider calls forbidden"); });
  const app = buildApp({ databasePath: ":memory:", assetStagingDirectory: staging, connectedEditing: { token, projectIds: [projectId], allowProjectCreation: true }, conversationalEditProvider: { id: "offline-edit", generate } });
  const client = new Client({ name: "w6-offline-demo", version: "1" });
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const call = async (name: string, args: Record<string, unknown>) => { const r = await client.callTool({ name, arguments: args }); if (r.isError) throw new Error(JSON.stringify(r.content)); return r.structuredContent as any; };
    await call("create_project", { projectId, operationId: randomUUID(), name: "W6 complete visual game", approved: true });
    const demo = await authorDemo(call, projectId, staging);
    expect(demo.assetEvidence).toHaveLength(5);
    for (const world of [demo.world, demo.freeWorld]) {
      const review = await call("review_world", { projectId, world }); await call("apply_world", { projectId, world, fingerprint: review.fingerprint, approved: true, operationId: randomUUID() });
      const ready = await call("publication_readiness", { projectId }); expect(ready.ready, JSON.stringify(ready)).toBe(true);
      const response = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/publication/compile`, payload: {} }); expect(response.statusCode, response.body).toBe(201);
      const { bundle, playerConfig: config } = response.json();
      for (const optional of [true, false]) for (const late of [true, false]) {
        const run = playDemo(bundle, config, optional, late); expect(playDemo(bundle, config, optional, late).final).toEqual(run.final);
        // Find by the actual initial passage because native identity has no demo-only aliases.
        const early = bundle.choices.find((c: { sourcePassageId: string; text: string }) => c.sourcePassageId === run.initial.state.currentPassageId && c.text === "Hand over the watch (early ending)");
        expect(early).toBeDefined();
        const handover = chooseNativePlayerSession(bundle, config, run.initial, early.id).session;
        const finishHandover = bundle.choices.find((c: { sourcePassageId: string; text: string }) => c.sourcePassageId === handover.state.currentPassageId && c.text === "Finish the handover");
        expect(finishHandover).toBeDefined();
        const handedOver = chooseNativePlayerSession(bundle, config, handover, finishHandover.id).session;
        expect(nativePlayerView(bundle, config, handedOver).terminal.result).toMatchObject({ kind: "completed-ending", endingId: "ending-3" });
        expect(handedOver.state.world!.journal!.completedObjectiveIds).toEqual([]);
        expect(() => chooseNativePlayerSession(bundle, config, run.initial, "choice-passage-shared-opening-continue")).toThrow();
        expect(presentCharacters(bundle.world, run.prepared.state)).toEqual([{ id: "mara", name: "Mara" }]);
        const shared = chooseNativePlayerSession(bundle, config, run.prepared, demo.sharedWatchChoiceId).session;
        const sharedEnding = chooseNativePlayerSession(bundle, config, shared, "choice-passage-route-2-act-ending-2").session;
        expect(nativePlayerView(bundle, config, sharedEnding).terminal.result).toMatchObject({ kind: "completed-ending", endingId: "ending-2" });
        expect(sharedEnding.state.world!.locationId).toBe("station"); expect(presentCharacters(bundle.world, sharedEnding.state)).toEqual([{ id: "mara", name: "Mara" }]);
        const backAtCafe = actNativePlayerWorld(bundle, config, run.prepared, { kind: "travel", id: "station-cafe" }).session;
        const crewAtStation = chooseNativePlayerSession(bundle, config, backAtCafe, demo.proof.generated["$new:compact"]).session;
        expect(crewAtStation.state.world!.locationId).toBe("station");
        expect(run.afterWarning.state.relationships[demo.trust]).toBe(2); expect(run.prepared.state.relationships[demo.trust]).toBe(3);
        expect(run.final.state.world!.economy).toMatchObject({ currency: 3, items: { tea: 0 } });
        expect(run.final.state.world!.journal!.completedObjectiveIds).toEqual(["cup", "signal", "warning"]);
        expect(run.final.state.world!.journal!.entryIds.includes("memory")).toBe(optional);
        expect(run.final.state.world!.progression!.chapterId).toBe(world.progression!.initialChapterId ? "signal" : null);
        expect(nativePlayerView(bundle, config, run.final).terminal.result).toMatchObject({ kind: "completed-ending", endingId: "ending-1" });
        const saved = createNativePlayerSave(bundle, config, run.afterWarning), loaded = loadNativePlayerSave(bundle, config, saved);
        let replay = actNativePlayerWorld(bundle, config, loaded, run.departure).session; replay = actNativePlayerWorld(bundle, config, replay, { kind: "event", id: "prepare" }).session; replay = chooseNativePlayerSession(bundle, config, replay, finalChoice).session;
        expect(replay).toEqual(run.final); expect(loadNativePlayerSave(bundle, config, createNativePlayerSave(bundle, config, run.final))).toEqual(run.final);
      }
    }
    expect(generate).not.toHaveBeenCalled();
  } finally { await client.close(); await app.close(); await rm(staging, { recursive: true, force: true }); }
}, 120000);
