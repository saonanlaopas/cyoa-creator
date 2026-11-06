import { expect, test } from "playwright/test";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("PF-003 creates keyed mechanics through MCP and Creator, then plays their conditions and effects offline", async ({ page, browser, playwright }, info) => {
  test.setTimeout(180000);
  const token = randomBytes(32).toString("hex"), directory = await mkdtemp(join(tmpdir(), "cyoa-pf003-"));
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { buildApp } from './apps/server/dist/app.js';
    import { ArtifactRepository, ChangeSetRepository, ProjectRepository, WorkflowRepository, openDatabase } from './packages/persistence/dist/index.js';
    import { LongFormProjectService } from './apps/server/dist/services/long-form-project-service.js';
    const db = openDatabase(process.env.PF003_DATABASE), artifacts = new ArtifactRepository(db);
    const service = new LongFormProjectService(new ProjectRepository(db), artifacts, new WorkflowRepository(db), new ChangeSetRepository(db));
    const created = service.createProject('Neutral mechanic laboratory'), id = created.project.id;
    const brief = service.saveArtifact(id, 'brief', { ...created.brief.content, routeTarget: 2, endingTarget: 3, totalWordTarget: 50000, typicalPlaythroughWordTarget: 20000 }).artifact;
    service.approveArtifact(id, 'brief', brief.id);
    const direction = service.saveArtifact(id, 'creative-direction', created.creativeDirection.content).artifact;
    service.approveArtifact(id, 'creative-direction', direction.id);
    for (const owner of ['bible','routes','endings','mechanics']) {
      let version = service.createArtifact(id, owner).artifact;
      if (owner === 'bible') version = service.saveArtifact(id, owner, { ...version.content,
        characters: ['Reviewer','Observer'].map(name => ({ id: 'character-' + name.toLowerCase(), name, role: name, summary: '', motivations: [], knowledge: [], plannedArc: '' })),
        relationships: [{ id: 'relationship-lab', characterIds: ['character-reviewer','character-observer'], label: 'Colleagues', currentState: '', plannedArc: '' }] }).artifact;
      if (owner === 'mechanics') version = service.saveArtifact(id, owner, { ...version.content, choiceEffectPlans: [{ id: 'existing-use', label: 'Existing values', sourceDecisionIds: ['decision-route-selection'], mechanicKeys: [...version.content.visibleStats,...version.content.relationships].map(m => m.key), effectGuidance: ['Retain existing meaning.'] }] }).artifact;
      service.approveArtifact(id, owner, version.id);
    }
    db.close();
    const app = buildApp({ databasePath: process.env.PF003_DATABASE, connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [id] },
      conversationalEditProvider: { id: 'offline-edit', async generate(plan) {
        if (plan.request.message !== 'Add a calibration marker') throw new Error('Unexpected fixture generation');
        return { message: 'Review the requested calibration flag', groups: [{ id: 'calibration', label: 'Calibration marker', explanation: 'A new authored key with its intended consequence', dependsOnGroupIds: [], operations: [
          { targetKey: 'mechanics:root', kind: 'add-item', collection: 'flags', item: { id: '$new:calibrated', key: 'calibrated_panel', label: 'Calibration recorded', meaning: 'The test panel was calibrated.' } },
          { targetKey: 'mechanics:root', kind: 'add-item', collection: 'choiceEffectPlans', item: { id: '$new:calibration-use', label: 'Calibration consequence', sourceDecisionIds: ['decision-route-selection'], mechanicKeys: ['calibrated_panel'], effectGuidance: ['Record calibration when inspecting.'] } }
        ] }] };
      } } });
    console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }), projectId: id }));
    process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
  `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token, PF003_DATABASE: join(directory, "fixture.sqlite") }, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", chunk => { errors += String(chunk); });
  try {
    const server = await new Promise<{ address: string; projectId: string }>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(`PF003 startup timeout: ${errors}`)), 10000);
      child.stdout.on("data", chunk => { output += String(chunk); for (const line of output.split("\n")) try { const row = JSON.parse(line); if (row.address) { clearTimeout(timer); resolve(row); } } catch { /* Wait for complete startup record. */ } });
      child.once("error", e => { clearTimeout(timer); reject(e); }); child.once("exit", () => { clearTimeout(timer); reject(new Error(`PF003 startup exited: ${errors}`)); });
    });
    const request = await playwright.request.newContext({ baseURL: server.address });
    const id = server.projectId, root = `/api/long-form/projects/${id}`;
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const reply = await request.post("/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } } });
        await expect(reply).toBeOK(); const result = (await reply.json()).result; expect(result.isError, JSON.stringify(result.content)).not.toBe(true); return result.structuredContent;
      };
      const foundation = (artifactId: string) => call("read_foundation", { projectId: id, artifactId });
      const before = await (await request.get(root)).json();
      const submit = async (message: string, targets: Array<{ key: string; versionId: string }>, operations: unknown[]) => {
        const state = await call("project_state", { projectId: id });
        const prepared = await call("prepare_edit", { projectId: id, operationId: randomUUID(), message, headFingerprint: state.headFingerprint, targets });
        const args = { projectId: id, operationId: randomUUID(), planId: prepared.plan.id, fingerprint: prepared.plan.fingerprint, response: { message, groups: [{ id: "requested", label: "Requested mechanic change", explanation: message, dependsOnGroupIds: [], operations }] } };
        const result = await call("submit_edit", args); expect(await call("submit_edit", args)).toEqual(result); return result;
      };
      const apply = async (proposalId: string) => {
        const review = await call("review_edit", { projectId: id, proposalId, groupIds: ["requested"] });
        const args = { projectId: id, operationId: randomUUID(), proposalId, groupIds: ["requested"], fingerprint: review.fingerprint, approved: true };
        const result = await call("apply_edit", args); expect(await call("apply_edit", args)).toEqual(result); return result;
      };
      const scale = { description: "Fixture-only score", minimum: 0, maximum: 10, initial: 0, increaseSignals: [], decreaseSignals: [] };
      const pairs = [
        ["visibleStats", { ...scale, id: "$new:focus", key: "focus", label: "Focus" }],
        ["relationships", { ...scale, id: "$new:cooperation", key: "cooperation", label: "Cooperation", relationshipId: "relationship-lab", bands: [] }],
        ["flags", { id: "$new:inspected", key: "inspected_panel", label: "Inspected panel", meaning: "Inspection is remembered." }],
        ["resources", { id: "$new:charge", key: "test_charge", label: "Test charge", kind: "counter", initial: 2, meaning: "Calibration charge; not a clock, currency or inventory substitute." }],
      ] as const;
      const m = await foundation("mechanics");
      const proposal = await submit("Add the four requested canonical mechanic records", [{ key: "mechanics:root", versionId: m.versionId }], [
        ...pairs.map(([collection, item]) => ({ targetKey: "mechanics:root", kind: "add-item", collection, item })),
        { targetKey: "mechanics:root", kind: "add-item", collection: "choiceEffectPlans", item: { id: "$new:use", label: "Inspection consequences", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: pairs.map(([, item]) => item.key), effectGuidance: ["Inspecting increases focus/cooperation, records inspection and consumes one charge."] } },
      ]);
      expect((await foundation("mechanics")).versionId).toBe(m.versionId);
      await page.goto(`${server.address}/api/health`);
      await page.evaluate(projectId => { localStorage.setItem("story-to-cyoa.long-form-project-id", projectId); localStorage.setItem("story-to-cyoa.long-form-stage", "editing"); }, id);
      await page.goto(`${server.address}/#long-form`);
      await page.getByRole("button", { name: "Open saved proposal" }).click();
      await page.getByRole("button", { name: "Review selected changes" }).click();
      const review = page.getByRole("region", { name: "Effective editing changes" });
      await review.getByText("mechanics / root: before and after", { exact: true }).click(); await expect(review).toContainText('"key": "test_charge"');
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 }); await page.locator(".edit-workspace").scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`pf003-review-${width}.png`), fullPage: true });
        await info.attach(`Creator mechanic review ${width}`, { path: info.outputPath(`pf003-review-${width}.png`), contentType: "image/png" });
      }
      await page.getByRole("button", { name: "Apply selected editing changes" }).click(); await expect(page.getByText(/Selected changes applied as draft versions/)).toBeVisible();
      expect((await call("get_edit", { projectId: id, proposalId: proposal.proposalId })).status).toBe("applied");
      await page.reload();
      await page.getByLabel("Find planning records").fill("mechanics:root");
      await page.getByRole("region", { name: "Planning records" }).getByRole("checkbox", { name: /mechanics:root$/ }).check();
      await page.getByLabel("Editing request").fill("Add a calibration marker");
      await page.getByRole("button", { name: "Preview editing scope" }).click();
      await expect(page.getByRole("region", { name: "Editing generation preview" })).toBeVisible();
      await page.getByLabel("Authorize this exact editing generation").check(); await page.getByRole("button", { name: "Generate editing response" }).click();
      await expect(page.getByRole("heading", { name: "Review proposal", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Review selected changes" }).click();
      await page.getByRole("button", { name: "Apply selected editing changes" }).click(); await expect(page.getByText(/Selected changes applied as draft versions/)).toBeVisible();
      const after = await (await request.get(root)).json();
      for (const owner of ["brief", "creativeDirection", "bible", "routes", "endings"]) { expect(before[owner]).toBeDefined(); expect(after[owner]).toEqual(before[owner]); }
      expect(after.mechanics.content.flags.map((f: any) => f.key)).toEqual(["inspected_panel", "calibrated_panel"]);
      expect(after.workflow.mechanics).toMatchObject({ status: "draft", approvedVersionId: before.mechanics.id });
      const current = await foundation("mechanics"), approval = await call("review_foundation_approval", { projectId: id, artifactId: "mechanics", versionId: current.versionId });
      await call("approve_foundation", { projectId: id, operationId: randomUUID(), artifactId: "mechanics", versionId: current.versionId, fingerprint: approval.fingerprint, approved: true });
      await call("initialize_game_plan", { projectId: id, operationId: randomUUID(), headFingerprint: (await call("game_state", { projectId: id })).headFingerprint, approved: true });
      const read = async (kind: string, entityId?: string) => (await call("read_game_record", { projectId: id, kind, ...(entityId ? { entityId } : {}) })).record;
      const structure = await read("structure"), opening = await read("passage", structure.content.startPassageId), inspect = await read("choice", opening.content.choiceIds[0]);
      const pivot = await read("passage", inspect.content.destinationPassageId), gated = await read("choice", pivot.content.choiceIds[0]);
      const effects = [ ["focus", "add", 1], ["cooperation", "add", 2], ["inspected_panel", "set", true], ["test_charge", "subtract", 1], ["calibrated_panel", "set", true] ] as const;
      const graph = await submit("Give the neutral inspection a concrete cost and remembered consequences", [
        { key: "passage-structure:root", versionId: structure.id }, { key: `passage:${opening.entityId}`, versionId: opening.id }, { key: `passage:${pivot.entityId}`, versionId: pivot.id }, { key: `choice:${inspect.entityId}`, versionId: inspect.id }, { key: `choice:${gated.entityId}`, versionId: gated.id },
      ], [
        { targetKey: "passage-structure:root", kind: "add-entity", entityKind: "choice", item: { ...inspect.content, id: "$new:skip", label: "Leave the panel untouched", effects: [], position: 1 } },
        { targetKey: "passage-structure:root", kind: "add-entity", entityKind: "choice", item: { ...gated.content, id: "$new:standard", label: "Use the standard check", effects: [], position: 1 } },
        { targetKey: `passage:${opening.entityId}`, kind: "set-fields", changes: { choiceIds: [...opening.content.choiceIds, "$new:skip"] } },
        { targetKey: `passage:${pivot.entityId}`, kind: "set-fields", changes: { choiceIds: [...pivot.content.choiceIds, "$new:standard"] } },
        { targetKey: `choice:${inspect.entityId}`, kind: "set-fields", changes: { label: "Inspect the panel" } },
        ...effects.map(([mechanicKey, operation, value], i) => ({ targetKey: `choice:${inspect.entityId}`, kind: "add-item", collection: "effects", item: { id: `$new:effect-${i}`, mechanicKey, operation, value, feedback: "Inspection has a recorded consequence.", visibility: "visible" } })),
        { targetKey: `choice:${gated.entityId}`, kind: "set-fields", changes: { label: "Use the calibrated reading", condition: { kind: "all", items: effects.map(([mechanicKey, , value]) => ({ kind: "compare", mechanicKey, operator: typeof value === "boolean" ? "eq" : "gte", value: typeof value === "boolean" ? true : 1 })) }, unavailableExplanation: "Inspect the panel first." } },
      ]);
      await apply(graph.proposalId);
      const planReview = await call("review_game_plan", { projectId: id });
      await call("approve_game_plan", { projectId: id, operationId: randomUUID(), headFingerprint: planReview.headFingerprint, fingerprint: planReview.fingerprint, approved: true });
      const game = await call("game_state", { projectId: id }), selections = [];
      for (const item of game.items) {
        const passage = await read("passage", item.entityId), authorRequest = "Write the exact neutral test passage as a candidate.";
        const context = await call("read_authoring_context", { projectId: id, passageId: item.entityId, request: authorRequest });
        const draft = await call("submit_draft", { contextVersion: 2, authoringContextFingerprint: context.fingerprint, projectId: id, operationId: randomUUID(), passageId: item.entityId, passageVersionId: passage.id, headFingerprint: (await call("game_state", { projectId: id })).headFingerprint, request: authorRequest, proseMarkdown: `This is the neutral test passage ${item.entityId}. The inspection and its consequences are recorded in canonical game state.`, approved: true });
        selections.push({ passageId: item.entityId, candidateDraftVersionId: draft.draftVersionId });
      }
      for (let offset = 0; offset < selections.length; offset += 12) {
        const batch = selections.slice(offset, offset + 12), drafts = await call("review_drafts", { projectId: id, selections: batch });
        await call("accept_drafts", { projectId: id, operationId: randomUUID(), selections: batch, fingerprint: drafts.fingerprint, approved: true });
      }
      const ready = await call("publication_readiness", { projectId: id }); expect(ready.ready).toBe(true);
      const compiled = await call("compile_game", { projectId: id, operationId: randomUUID(), headFingerprint: ready.headFingerprint, fingerprint: ready.fingerprint, approved: true });
      const config = await request.put(`${root}/publication/player-config`, { data: { rewindPolicy: { kind: "previous-step" }, autosaveEnabled: true, manualSlotLimit: 5, visibleMechanicKeys: ["focus"] } }); await expect(config).toBeOK();
      const exported = await call("export_game", { projectId: id, buildVersionId: compiled.buildVersionId, format: "standalone" });
      const download = await request.get(exported.downloadPath); await expect(download).toBeOK();
      const html = await download.text(), file = join(directory, "neutral-mechanics.html"); await writeFile(file, html);
      await info.attach("Actual standalone player", { body: html, contentType: "text/html" });
      await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
      const context = await browser.newContext(), player = await context.newPage(), network: string[] = [];
      try {
        const savedState = () => player.evaluate(() => new Promise<any>((resolve, reject) => {
          const open = indexedDB.open("story-to-cyoa-native-player-v1");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result, read = db.transaction("autosaves", "readonly").objectStore("autosaves").getAll();
            read.onerror = () => { db.close(); reject(read.error); };
            read.onsuccess = () => { db.close(); resolve(read.result[0]?.value?.state); };
          };
        }));
        player.on("request", r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
        await player.goto(pathToFileURL(file).href); await player.getByRole("button", { name: "Inspect the panel", exact: true }).click();
        await expect(player.getByRole("button", { name: "Use the calibrated reading", exact: true })).toBeEnabled();
        const status = player.getByRole("complementary", { name: "Game status and saves" });
        await expect(status.getByText("Focus", { exact: true }).locator(".." )).toContainText("1");
        await player.getByRole("button", { name: "Save game", exact: true }).click(); await player.getByLabel("Save name", { exact: true }).fill("After inspection");
        await player.getByRole("button", { name: "Create save", exact: true }).click(); await expect(player.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
        const inspectedState = await savedState();
        expect(inspectedState).toMatchObject({ stats: { focus: 1 }, relationships: { cooperation: 2 }, flags: { inspected_panel: true, calibrated_panel: true }, resources: { test_charge: 1 } });
        await player.reload(); await expect(player.getByRole("button", { name: "Use the calibrated reading", exact: true })).toBeEnabled();
        expect(await savedState()).toEqual(inspectedState);
        for (const width of [1280, 390]) { await player.setViewportSize({ width, height: 900 }); await player.screenshot({ path: info.outputPath(`pf003-export-${width}.png`), fullPage: true }); await info.attach(`Offline keyed mechanic ${width}`, { path: info.outputPath(`pf003-export-${width}.png`), contentType: "image/png" }); }
        await player.getByRole("button", { name: "Rewind", exact: true }).click(); await player.getByRole("button", { name: "Leave the panel untouched", exact: true }).click();
        await expect(player.getByRole("button", { name: /Use the calibrated reading/ })).toBeDisabled(); await expect(player.getByText("Inspect the panel first.", { exact: true })).toBeVisible();
        await expect(player.getByRole("button", { name: "Use the standard check", exact: true })).toBeEnabled();
        const skippedState = await savedState();
        expect(skippedState).toMatchObject({ stats: { focus: 0 }, relationships: { cooperation: 0 }, flags: { inspected_panel: false, calibrated_panel: false }, resources: { test_charge: 2 } });
        await player.getByRole("button", { name: "Rewind", exact: true }).click(); await player.getByRole("button", { name: "Inspect the panel", exact: true }).click();
        await expect(player.getByRole("button", { name: "Use the calibrated reading", exact: true })).toBeEnabled();
        const replayedState = await savedState(); expect(replayedState).toEqual(inspectedState);
        const statePath = info.outputPath("pf003-runtime-state.json"); await writeFile(statePath, JSON.stringify({ inspectedState, skippedState, replayedState }, null, 2));
        await info.attach("Keyed mechanic runtime state", { path: statePath, contentType: "application/json" });
        await player.getByRole("button", { name: "Use the calibrated reading", exact: true }).click();
        expect(network).toEqual([]);
      } finally { await context.close(); }
    } finally { await request.dispose(); }
  } finally {
    if (child.exitCode === null) await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
    await rm(directory, { recursive: true, force: true });
  }
});
