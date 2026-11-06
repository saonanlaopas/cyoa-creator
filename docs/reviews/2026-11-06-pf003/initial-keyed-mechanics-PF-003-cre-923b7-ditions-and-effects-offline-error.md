# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: keyed-mechanics.spec.ts >> PF-003 creates keyed mechanics through MCP and Creator, then plays their conditions and effects offline
- Location: e2e/keyed-mechanics.spec.ts:9:5

# Error details

```
Error: locator.check: Error: strict mode violation: getByRole('region', { name: 'Planning records' }).getByRole('checkbox') resolved to 45 elements:
    1) <input type="checkbox"/> aka getByRole('checkbox', { name: 'brief / root brief:root' })
    2) <input type="checkbox"/> aka getByRole('checkbox', { name: 'creative-direction / root' })
    3) <input type="checkbox"/> aka getByRole('checkbox', { name: 'creative-direction / section:tone creative-direction:section:tone' })
    4) <input type="checkbox"/> aka getByRole('checkbox', { name: 'creative-direction / section:pacing creative-direction:section:pacing' })
    5) <input type="checkbox"/> aka getByRole('checkbox', { name: 'creative-direction / section:prose creative-direction:section:prose' })
    6) <input type="checkbox"/> aka getByRole('checkbox', { name: 'creative-direction / relationshipPresentation creative-direction:section:' })
    7) <input type="checkbox"/> aka getByRole('checkbox', { name: 'bible / Neutral mechanic' })
    8) <input type="checkbox"/> aka getByRole('checkbox', { name: 'bible / Reviewer bible:' })
    9) <input type="checkbox"/> aka getByRole('checkbox', { name: 'bible / Observer bible:' })
    10) <input type="checkbox"/> aka getByRole('checkbox', { name: 'bible / Colleagues bible:' })
    ...

Call log:
  - waiting for getByRole('region', { name: 'Planning records' }).getByRole('checkbox')

```

# Page snapshot

```yaml
- generic [ref=f2e2]:
  - link "Skip to main content" [ref=f2e3] [cursor=pointer]:
    - /url: "#main-content"
  - navigation "Application mode" [ref=f2e4]:
    - button "Quick prototype" [ref=f2e5] [cursor=pointer]
    - button "Long-form workspace" [ref=f2e6] [cursor=pointer]
  - main [ref=f2e7]:
    - navigation "Long-form workflow" [ref=f2e8]:
      - paragraph [ref=f2e9]: Long-form project
      - heading "Neutral mechanic laboratory" [level=2] [ref=f2e10]
      - group "Workspace" [ref=f2e11]:
        - generic [ref=f2e13]:
          - radio "Director" [ref=f2e14]
          - text: Director
        - generic [ref=f2e15]:
          - radio "Review" [ref=f2e16]
          - text: Review
        - generic [ref=f2e17]:
          - radio "Advanced" [checked] [ref=f2e18]
          - text: Advanced
      - paragraph [ref=f2e19]: Conversational editing
      - generic [ref=f2e20]:
        - text: Switch project
        - combobox "Switch project" [ref=f2e21]:
          - option "Neutral mechanic laboratory" [selected]
      - button "New project" [ref=f2e22] [cursor=pointer]
      - generic [ref=f2e23]:
        - button "Talk it through" [ref=f2e24] [cursor=pointer]
        - button "Analyze a supplied story" [ref=f2e25] [cursor=pointer]
        - button "Adaptation Intent" [ref=f2e26] [cursor=pointer]
        - button "Foundation bootstrap" [ref=f2e27] [cursor=pointer]
        - button "Conversational editing" [ref=f2e28] [cursor=pointer]
      - button "Authoring preferences" [ref=f2e29] [cursor=pointer]
      - button "Asset library" [ref=f2e30] [cursor=pointer]
      - button "Illustrated scenes" [ref=f2e31] [cursor=pointer]
      - button "Locations and time" [ref=f2e32] [cursor=pointer]
      - group [ref=f2e33]:
        - generic "Advanced workspace" [ref=f2e34]
        - list [ref=f2e35]:
          - listitem [ref=f2e36]:
            - button "Source analysis Available" [ref=f2e37] [cursor=pointer]:
              - generic [ref=f2e38]: Source analysis
              - generic [ref=f2e39]: Available
          - listitem [ref=f2e40]:
            - button "Project brief approved" [ref=f2e41] [cursor=pointer]:
              - generic [ref=f2e42]: Project brief
              - generic [ref=f2e43]: approved
          - listitem [ref=f2e44]:
            - button "Creative Direction approved" [ref=f2e45] [cursor=pointer]:
              - generic [ref=f2e46]: Creative Direction
              - generic [ref=f2e47]: approved
          - listitem [ref=f2e48]:
            - button "Story bible approved" [ref=f2e49] [cursor=pointer]:
              - generic [ref=f2e50]: Story bible
              - generic [ref=f2e51]: approved
          - listitem [ref=f2e52]:
            - button "Routes approved" [ref=f2e53] [cursor=pointer]:
              - generic [ref=f2e54]: Routes
              - generic [ref=f2e55]: approved
          - listitem [ref=f2e56]:
            - button "Endings approved" [ref=f2e57] [cursor=pointer]:
              - generic [ref=f2e58]: Endings
              - generic [ref=f2e59]: approved
          - listitem [ref=f2e60]:
            - button "Mechanics draft" [ref=f2e61] [cursor=pointer]:
              - generic [ref=f2e62]: Mechanics
              - generic [ref=f2e63]: draft
          - listitem [ref=f2e64]:
            - button "Passage plan Not started" [disabled] [ref=f2e65]:
              - generic [ref=f2e66]: Passage plan
              - generic [ref=f2e67]: Not started
          - listitem [ref=f2e68]:
            - button "Drafts Not started" [disabled] [ref=f2e69]:
              - generic [ref=f2e70]: Drafts
              - generic [ref=f2e71]: Not started
          - listitem [ref=f2e72]:
            - button "Playtest & analysis Not started" [disabled] [ref=f2e73]:
              - generic [ref=f2e74]: Playtest & analysis
              - generic [ref=f2e75]: Not started
          - listitem [ref=f2e76]:
            - button "Repair planning Not started" [disabled] [ref=f2e77]:
              - generic [ref=f2e78]: Repair planning
              - generic [ref=f2e79]: Not started
          - listitem [ref=f2e80]:
            - button "Publication Not started" [disabled] [ref=f2e81]:
              - generic [ref=f2e82]: Publication
              - generic [ref=f2e83]: Not started
          - listitem [ref=f2e84]:
            - button "Resume work Available" [ref=f2e85] [cursor=pointer]:
              - generic [ref=f2e86]: Resume work
              - generic [ref=f2e87]: Available
          - listitem [ref=f2e88]:
            - button "Project health Available" [ref=f2e89] [cursor=pointer]:
              - generic [ref=f2e90]: Project health
              - generic [ref=f2e91]: Available
          - listitem [ref=f2e92]:
            - button "Backup & recovery Available" [ref=f2e93] [cursor=pointer]:
              - generic [ref=f2e94]: Backup & recovery
              - generic [ref=f2e95]: Available
        - region [ref=f2e96]:
          - heading "Session navigation" [level=3] [ref=f2e97]
          - paragraph [ref=f2e98]: Neutral mechanic laboratory / Conversational editing
          - button "Back to previous workspace" [disabled] [ref=f2e99]
          - generic [ref=f2e100]:
            - text: Stable ID jump
            - textbox "Stable ID jump" [ref=f2e101]:
              - /placeholder: passage or entity ID
          - generic [ref=f2e102]:
            - button "Jump" [disabled] [ref=f2e103]
            - button "Copy ID" [disabled] [ref=f2e104]
          - generic [ref=f2e105]: Stored only in this browser; never treated as project workflow state.
    - region "Conversational editing" [ref=f2e106]:
      - generic [ref=f2e107]:
        - heading "Conversational editing" [level=1] [ref=f2e108]
        - generic [ref=f2e109]: Draft proposals
      - generic [ref=f2e110]:
        - heading "Scope" [level=2] [ref=f2e111]
        - generic [ref=f2e112]:
          - text: Find planning records
          - textbox "Find planning records" [active] [ref=f2e113]: mechanics:root
        - region "Planning records" [ref=f2e114]:
          - generic [ref=f2e115]:
            - checkbox "mechanics / Neutral mechanic laboratory mechanics mechanics:root" [ref=f2e116]
            - generic [ref=f2e117]:
              - text: mechanics / Neutral mechanic laboratory mechanics
              - generic [ref=f2e118]: mechanics:root
        - generic [ref=f2e119]:
          - button "Previous records" [disabled] [ref=f2e120]
          - generic [ref=f2e121]: 1-1 of 1
          - button "Next records" [disabled] [ref=f2e122]
        - heading "Selected scope (0/12)" [level=3] [ref=f2e123]
        - paragraph [ref=f2e124]: No explicit scope selected
      - generic [ref=f2e125]:
        - heading "Director request" [level=2] [ref=f2e126]
        - generic [ref=f2e127]:
          - text: Editing request
          - textbox "Editing request" [ref=f2e128]
        - group "Intent" [ref=f2e129]:
          - generic [ref=f2e131]:
            - radio "Propose edits" [checked] [ref=f2e132]
            - text: Propose edits
          - generic [ref=f2e133]:
            - radio "Discuss" [ref=f2e134]
            - text: Discuss
        - generic [ref=f2e135]:
          - generic [ref=f2e136]:
            - text: Editing provider
            - combobox "Editing provider" [ref=f2e137]:
              - option "Offline editor" [selected]
              - option "OpenRouter"
          - generic [ref=f2e138]:
            - text: Editing model
            - textbox "Editing model" [disabled] [ref=f2e139]: offline-edit-v1
        - button "Preview editing scope" [disabled] [ref=f2e140]
      - generic [ref=f2e141]:
        - heading "Conversation history" [level=2] [ref=f2e142]
        - generic [ref=f2e143]:
          - generic [ref=f2e144]: applied / Add the four requested canonical mechanic records
          - button "Open saved proposal" [ref=f2e145] [cursor=pointer]
        - group [ref=f2e146]:
          - generic "Recent messages" [ref=f2e147]
```

# Test source

```ts
  1   | import { expect, test } from "playwright/test";
  2   | import { spawn } from "node:child_process";
  3   | import { randomBytes, randomUUID } from "node:crypto";
  4   | import { mkdtemp, rm, writeFile } from "node:fs/promises";
  5   | import { tmpdir } from "node:os";
  6   | import { join } from "node:path";
  7   | import { pathToFileURL } from "node:url";
  8   | 
  9   | test("PF-003 creates keyed mechanics through MCP and Creator, then plays their conditions and effects offline", async ({ page, browser, playwright }, info) => {
  10  |   test.setTimeout(180000);
  11  |   const token = randomBytes(32).toString("hex"), directory = await mkdtemp(join(tmpdir(), "cyoa-pf003-"));
  12  |   const child = spawn(process.execPath, ["--input-type=module", "-e", `
  13  |     import { buildApp } from './apps/server/dist/app.js';
  14  |     import { ArtifactRepository, ChangeSetRepository, ProjectRepository, WorkflowRepository, openDatabase } from './packages/persistence/dist/index.js';
  15  |     import { LongFormProjectService } from './apps/server/dist/services/long-form-project-service.js';
  16  |     const db = openDatabase(process.env.PF003_DATABASE), artifacts = new ArtifactRepository(db);
  17  |     const service = new LongFormProjectService(new ProjectRepository(db), artifacts, new WorkflowRepository(db), new ChangeSetRepository(db));
  18  |     const created = service.createProject('Neutral mechanic laboratory'), id = created.project.id;
  19  |     const brief = service.saveArtifact(id, 'brief', { ...created.brief.content, routeTarget: 2, endingTarget: 3, totalWordTarget: 50000, typicalPlaythroughWordTarget: 20000 }).artifact;
  20  |     service.approveArtifact(id, 'brief', brief.id);
  21  |     const direction = service.saveArtifact(id, 'creative-direction', created.creativeDirection.content).artifact;
  22  |     service.approveArtifact(id, 'creative-direction', direction.id);
  23  |     for (const owner of ['bible','routes','endings','mechanics']) {
  24  |       let version = service.createArtifact(id, owner).artifact;
  25  |       if (owner === 'bible') version = service.saveArtifact(id, owner, { ...version.content,
  26  |         characters: ['Reviewer','Observer'].map(name => ({ id: 'character-' + name.toLowerCase(), name, role: name, summary: '', motivations: [], knowledge: [], plannedArc: '' })),
  27  |         relationships: [{ id: 'relationship-lab', characterIds: ['character-reviewer','character-observer'], label: 'Colleagues', currentState: '', plannedArc: '' }] }).artifact;
  28  |       if (owner === 'mechanics') version = service.saveArtifact(id, owner, { ...version.content, choiceEffectPlans: [{ id: 'existing-use', label: 'Existing values', sourceDecisionIds: ['decision-route-selection'], mechanicKeys: [...version.content.visibleStats,...version.content.relationships].map(m => m.key), effectGuidance: ['Retain existing meaning.'] }] }).artifact;
  29  |       service.approveArtifact(id, owner, version.id);
  30  |     }
  31  |     db.close();
  32  |     const app = buildApp({ databasePath: process.env.PF003_DATABASE, connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [id] },
  33  |       conversationalEditProvider: { id: 'offline-edit', async generate(plan) {
  34  |         if (plan.request.message !== 'Add a calibration marker') throw new Error('Unexpected fixture generation');
  35  |         return { message: 'Review the requested calibration flag', groups: [{ id: 'calibration', label: 'Calibration marker', explanation: 'A new authored key with its intended consequence', dependsOnGroupIds: [], operations: [
  36  |           { targetKey: 'mechanics:root', kind: 'add-item', collection: 'flags', item: { id: '$new:calibrated', key: 'calibrated_panel', label: 'Calibration recorded', meaning: 'The test panel was calibrated.' } },
  37  |           { targetKey: 'mechanics:root', kind: 'add-item', collection: 'choiceEffectPlans', item: { id: '$new:calibration-use', label: 'Calibration consequence', sourceDecisionIds: ['decision-route-selection'], mechanicKeys: ['calibrated_panel'], effectGuidance: ['Record calibration when inspecting.'] } }
  38  |         ] }] };
  39  |       } } });
  40  |     console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }), projectId: id }));
  41  |     process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
  42  |   `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token, PF003_DATABASE: join(directory, "fixture.sqlite") }, stdio: ["ignore", "pipe", "pipe"] });
  43  |   let errors = ""; child.stderr.on("data", chunk => { errors += String(chunk); });
  44  |   try {
  45  |     const server = await new Promise<{ address: string; projectId: string }>((resolve, reject) => {
  46  |       let output = ""; const timer = setTimeout(() => reject(new Error(`PF003 startup timeout: ${errors}`)), 10000);
  47  |       child.stdout.on("data", chunk => { output += String(chunk); for (const line of output.split("\n")) try { const row = JSON.parse(line); if (row.address) { clearTimeout(timer); resolve(row); } } catch { /* Wait for complete startup record. */ } });
  48  |       child.once("error", e => { clearTimeout(timer); reject(e); }); child.once("exit", () => { clearTimeout(timer); reject(new Error(`PF003 startup exited: ${errors}`)); });
  49  |     });
  50  |     const request = await playwright.request.newContext({ baseURL: server.address });
  51  |     const id = server.projectId, root = `/api/long-form/projects/${id}`;
  52  |     try {
  53  |       const call = async (name: string, args: Record<string, unknown>) => {
  54  |         const reply = await request.post("/mcp", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } } });
  55  |         await expect(reply).toBeOK(); const result = (await reply.json()).result; expect(result.isError, JSON.stringify(result.content)).not.toBe(true); return result.structuredContent;
  56  |       };
  57  |       const foundation = (artifactId: string) => call("read_foundation", { projectId: id, artifactId });
  58  |       const before = await (await request.get(root)).json();
  59  |       const submit = async (message: string, targets: Array<{ key: string; versionId: string }>, operations: unknown[]) => {
  60  |         const state = await call("project_state", { projectId: id });
  61  |         const prepared = await call("prepare_edit", { projectId: id, operationId: randomUUID(), message, headFingerprint: state.headFingerprint, targets });
  62  |         const args = { projectId: id, operationId: randomUUID(), planId: prepared.plan.id, fingerprint: prepared.plan.fingerprint, response: { message, groups: [{ id: "requested", label: "Requested mechanic change", explanation: message, dependsOnGroupIds: [], operations }] } };
  63  |         const result = await call("submit_edit", args); expect(await call("submit_edit", args)).toEqual(result); return result;
  64  |       };
  65  |       const apply = async (proposalId: string) => {
  66  |         const review = await call("review_edit", { projectId: id, proposalId, groupIds: ["requested"] });
  67  |         const args = { projectId: id, operationId: randomUUID(), proposalId, groupIds: ["requested"], fingerprint: review.fingerprint, approved: true };
  68  |         const result = await call("apply_edit", args); expect(await call("apply_edit", args)).toEqual(result); return result;
  69  |       };
  70  |       const scale = { description: "Fixture-only score", minimum: 0, maximum: 10, initial: 0, increaseSignals: [], decreaseSignals: [] };
  71  |       const pairs = [
  72  |         ["visibleStats", { ...scale, id: "$new:focus", key: "focus", label: "Focus" }],
  73  |         ["relationships", { ...scale, id: "$new:cooperation", key: "cooperation", label: "Cooperation", relationshipId: "relationship-lab", bands: [] }],
  74  |         ["flags", { id: "$new:inspected", key: "inspected_panel", label: "Inspected panel", meaning: "Inspection is remembered." }],
  75  |         ["resources", { id: "$new:charge", key: "test_charge", label: "Test charge", kind: "counter", initial: 2, meaning: "Calibration charge; not a clock, currency or inventory substitute." }],
  76  |       ] as const;
  77  |       const m = await foundation("mechanics");
  78  |       const proposal = await submit("Add the four requested canonical mechanic records", [{ key: "mechanics:root", versionId: m.versionId }], [
  79  |         ...pairs.map(([collection, item]) => ({ targetKey: "mechanics:root", kind: "add-item", collection, item })),
  80  |         { targetKey: "mechanics:root", kind: "add-item", collection: "choiceEffectPlans", item: { id: "$new:use", label: "Inspection consequences", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: pairs.map(([, item]) => item.key), effectGuidance: ["Inspecting increases focus/cooperation, records inspection and consumes one charge."] } },
  81  |       ]);
  82  |       expect((await foundation("mechanics")).versionId).toBe(m.versionId);
  83  |       await page.goto(`${server.address}/api/health`);
  84  |       await page.evaluate(projectId => { localStorage.setItem("story-to-cyoa.long-form-project-id", projectId); localStorage.setItem("story-to-cyoa.long-form-stage", "editing"); }, id);
  85  |       await page.goto(`${server.address}/#long-form`);
  86  |       await page.getByRole("button", { name: "Open saved proposal" }).click();
  87  |       await page.getByRole("button", { name: "Review selected changes" }).click();
  88  |       const review = page.getByRole("region", { name: "Effective editing changes" });
  89  |       await review.getByText("mechanics / root: before and after", { exact: true }).click(); await expect(review).toContainText('"key": "test_charge"');
  90  |       for (const width of [1280, 390]) {
  91  |         await page.setViewportSize({ width, height: 900 }); await page.locator(".edit-workspace").scrollIntoViewIfNeeded();
  92  |         await page.screenshot({ path: info.outputPath(`pf003-review-${width}.png`), fullPage: true });
  93  |         await info.attach(`Creator mechanic review ${width}`, { path: info.outputPath(`pf003-review-${width}.png`), contentType: "image/png" });
  94  |       }
  95  |       await page.getByRole("button", { name: "Apply selected editing changes" }).click(); await expect(page.getByText(/Selected changes applied as draft versions/)).toBeVisible();
  96  |       expect((await call("get_edit", { projectId: id, proposalId: proposal.proposalId })).status).toBe("applied");
  97  |       await page.reload();
  98  |       await page.getByLabel("Find planning records").fill("mechanics:root");
> 99  |       await page.getByRole("region", { name: "Planning records" }).getByRole("checkbox").check();
      |                                                                                          ^ Error: locator.check: Error: strict mode violation: getByRole('region', { name: 'Planning records' }).getByRole('checkbox') resolved to 45 elements:
  100 |       await page.getByLabel("Editing request").fill("Add a calibration marker");
  101 |       await page.getByRole("button", { name: "Preview editing scope" }).click();
  102 |       await expect(page.getByRole("region", { name: "Editing generation preview" })).toBeVisible();
  103 |       await page.getByLabel("Authorize this exact editing generation").check(); await page.getByRole("button", { name: "Generate editing response" }).click();
  104 |       await expect(page.getByRole("heading", { name: "Review proposal", exact: true })).toBeVisible();
  105 |       await page.getByRole("button", { name: "Review selected changes" }).click();
  106 |       await page.getByRole("button", { name: "Apply selected editing changes" }).click(); await expect(page.getByText(/Selected changes applied as draft versions/)).toBeVisible();
  107 |       const after = await (await request.get(root)).json();
  108 |       for (const owner of ["brief", "creativeDirection", "bible", "routes", "endings"]) { expect(before[owner]).toBeDefined(); expect(after[owner]).toEqual(before[owner]); }
  109 |       expect(after.mechanics.content.flags.map((f: any) => f.key)).toEqual(["inspected_panel", "calibrated_panel"]);
  110 |       expect(after.workflow.mechanics).toMatchObject({ status: "draft", approvedVersionId: before.mechanics.id });
  111 |       const current = await foundation("mechanics"), approval = await call("review_foundation_approval", { projectId: id, artifactId: "mechanics", versionId: current.versionId });
  112 |       await call("approve_foundation", { projectId: id, operationId: randomUUID(), artifactId: "mechanics", versionId: current.versionId, fingerprint: approval.fingerprint, approved: true });
  113 |       await call("initialize_game_plan", { projectId: id, operationId: randomUUID(), headFingerprint: (await call("game_state", { projectId: id })).headFingerprint, approved: true });
  114 |       const read = async (kind: string, entityId?: string) => (await call("read_game_record", { projectId: id, kind, ...(entityId ? { entityId } : {}) })).record;
  115 |       const structure = await read("structure"), opening = await read("passage", structure.content.startPassageId), inspect = await read("choice", opening.content.choiceIds[0]);
  116 |       const pivot = await read("passage", inspect.content.destinationPassageId), gated = await read("choice", pivot.content.choiceIds[0]);
  117 |       const effects = [ ["focus", "add", 1], ["cooperation", "add", 2], ["inspected_panel", "set", true], ["test_charge", "subtract", 1], ["calibrated_panel", "set", true] ] as const;
  118 |       const graph = await submit("Give the neutral inspection a concrete cost and remembered consequences", [
  119 |         { key: "passage-structure:root", versionId: structure.id }, { key: `passage:${opening.entityId}`, versionId: opening.id }, { key: `passage:${pivot.entityId}`, versionId: pivot.id }, { key: `choice:${inspect.entityId}`, versionId: inspect.id }, { key: `choice:${gated.entityId}`, versionId: gated.id },
  120 |       ], [
  121 |         { targetKey: "passage-structure:root", kind: "add-entity", entityKind: "choice", item: { ...inspect.content, id: "$new:skip", label: "Leave the panel untouched", effects: [], position: 1 } },
  122 |         { targetKey: "passage-structure:root", kind: "add-entity", entityKind: "choice", item: { ...gated.content, id: "$new:standard", label: "Use the standard check", effects: [], position: 1 } },
  123 |         { targetKey: `passage:${opening.entityId}`, kind: "set-fields", changes: { choiceIds: [...opening.content.choiceIds, "$new:skip"] } },
  124 |         { targetKey: `passage:${pivot.entityId}`, kind: "set-fields", changes: { choiceIds: [...pivot.content.choiceIds, "$new:standard"] } },
  125 |         { targetKey: `choice:${inspect.entityId}`, kind: "set-fields", changes: { label: "Inspect the panel" } },
  126 |         ...effects.map(([mechanicKey, operation, value], i) => ({ targetKey: `choice:${inspect.entityId}`, kind: "add-item", collection: "effects", item: { id: `$new:effect-${i}`, mechanicKey, operation, value, feedback: "Inspection has a recorded consequence.", visibility: "visible" } })),
  127 |         { targetKey: `choice:${gated.entityId}`, kind: "set-fields", changes: { label: "Use the calibrated reading", condition: { kind: "all", items: effects.map(([mechanicKey, , value]) => ({ kind: "compare", mechanicKey, operator: typeof value === "boolean" ? "eq" : "gte", value: typeof value === "boolean" ? true : 1 })) }, unavailableExplanation: "Inspect the panel first." } },
  128 |       ]);
  129 |       await apply(graph.proposalId);
  130 |       const planReview = await call("review_game_plan", { projectId: id });
  131 |       await call("approve_game_plan", { projectId: id, operationId: randomUUID(), headFingerprint: planReview.headFingerprint, fingerprint: planReview.fingerprint, approved: true });
  132 |       const game = await call("game_state", { projectId: id }), selections = [];
  133 |       for (const item of game.items) {
  134 |         const passage = await read("passage", item.entityId), authorRequest = "Write the exact neutral test passage as a candidate.";
  135 |         const context = await call("read_authoring_context", { projectId: id, passageId: item.entityId, request: authorRequest });
  136 |         const draft = await call("submit_draft", { contextVersion: 2, authoringContextFingerprint: context.fingerprint, projectId: id, operationId: randomUUID(), passageId: item.entityId, passageVersionId: passage.id, headFingerprint: (await call("game_state", { projectId: id })).headFingerprint, request: authorRequest, proseMarkdown: `This is the neutral test passage ${item.entityId}. The inspection and its consequences are recorded in canonical game state.`, approved: true });
  137 |         selections.push({ passageId: item.entityId, candidateDraftVersionId: draft.draftVersionId });
  138 |       }
  139 |       for (let offset = 0; offset < selections.length; offset += 12) {
  140 |         const batch = selections.slice(offset, offset + 12), drafts = await call("review_drafts", { projectId: id, selections: batch });
  141 |         await call("accept_drafts", { projectId: id, operationId: randomUUID(), selections: batch, fingerprint: drafts.fingerprint, approved: true });
  142 |       }
  143 |       const ready = await call("publication_readiness", { projectId: id }); expect(ready.ready).toBe(true);
  144 |       const compiled = await call("compile_game", { projectId: id, operationId: randomUUID(), headFingerprint: ready.headFingerprint, fingerprint: ready.fingerprint, approved: true });
  145 |       const config = await request.put(`${root}/publication/player-config`, { data: { rewindPolicy: { kind: "previous-step" }, autosaveEnabled: true, manualSlotLimit: 5, visibleMechanicKeys: ["focus"] } }); await expect(config).toBeOK();
  146 |       const exported = await call("export_game", { projectId: id, buildVersionId: compiled.buildVersionId, format: "standalone" });
  147 |       const download = await request.get(exported.downloadPath); await expect(download).toBeOK();
  148 |       const html = await download.text(), file = join(directory, "neutral-mechanics.html"); await writeFile(file, html);
  149 |       await info.attach("Actual standalone player", { body: html, contentType: "text/html" });
  150 |       await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
  151 |       const context = await browser.newContext(), player = await context.newPage(), network: string[] = [];
  152 |       try {
  153 |         const savedState = () => player.evaluate(() => new Promise<any>((resolve, reject) => {
  154 |           const open = indexedDB.open("story-to-cyoa-native-player-v1");
  155 |           open.onerror = () => reject(open.error);
  156 |           open.onsuccess = () => {
  157 |             const db = open.result, read = db.transaction("autosaves", "readonly").objectStore("autosaves").getAll();
  158 |             read.onerror = () => { db.close(); reject(read.error); };
  159 |             read.onsuccess = () => { db.close(); resolve(read.result[0]?.value?.state); };
  160 |           };
  161 |         }));
  162 |         player.on("request", r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
  163 |         await player.goto(pathToFileURL(file).href); await player.getByRole("button", { name: "Inspect the panel", exact: true }).click();
  164 |         await expect(player.getByRole("button", { name: "Use the calibrated reading", exact: true })).toBeEnabled();
  165 |         const status = player.getByRole("complementary", { name: "Game status and saves" });
  166 |         await expect(status.getByText("Focus", { exact: true }).locator(".." )).toContainText("1");
  167 |         await player.getByRole("button", { name: "Save game", exact: true }).click(); await player.getByLabel("Save name", { exact: true }).fill("After inspection");
  168 |         await player.getByRole("button", { name: "Create save", exact: true }).click(); await expect(player.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  169 |         const inspectedState = await savedState();
  170 |         expect(inspectedState).toMatchObject({ stats: { focus: 1 }, relationships: { cooperation: 2 }, flags: { inspected_panel: true, calibrated_panel: true }, resources: { test_charge: 1 } });
  171 |         await player.reload(); await expect(player.getByRole("button", { name: "Use the calibrated reading", exact: true })).toBeEnabled();
  172 |         expect(await savedState()).toEqual(inspectedState);
  173 |         for (const width of [1280, 390]) { await player.setViewportSize({ width, height: 900 }); await player.screenshot({ path: info.outputPath(`pf003-export-${width}.png`), fullPage: true }); await info.attach(`Offline keyed mechanic ${width}`, { path: info.outputPath(`pf003-export-${width}.png`), contentType: "image/png" }); }
  174 |         await player.getByRole("button", { name: "Rewind", exact: true }).click(); await player.getByRole("button", { name: "Leave the panel untouched", exact: true }).click();
  175 |         await expect(player.getByRole("button", { name: /Use the calibrated reading/ })).toBeDisabled(); await expect(player.getByText("Inspect the panel first.", { exact: true })).toBeVisible();
  176 |         await expect(player.getByRole("button", { name: "Use the standard check", exact: true })).toBeEnabled();
  177 |         const skippedState = await savedState();
  178 |         expect(skippedState).toMatchObject({ stats: { focus: 0 }, relationships: { cooperation: 0 }, flags: { inspected_panel: false, calibrated_panel: false }, resources: { test_charge: 2 } });
  179 |         await player.getByRole("button", { name: "Rewind", exact: true }).click(); await player.getByRole("button", { name: "Inspect the panel", exact: true }).click();
  180 |         await expect(player.getByRole("button", { name: "Use the calibrated reading", exact: true })).toBeEnabled();
  181 |         const replayedState = await savedState(); expect(replayedState).toEqual(inspectedState);
  182 |         const statePath = info.outputPath("pf003-runtime-state.json"); await writeFile(statePath, JSON.stringify({ inspectedState, skippedState, replayedState }, null, 2));
  183 |         await info.attach("Keyed mechanic runtime state", { path: statePath, contentType: "application/json" });
  184 |         await player.getByRole("button", { name: "Use the calibrated reading", exact: true }).click();
  185 |         expect(network).toEqual([]);
  186 |       } finally { await context.close(); }
  187 |     } finally { await request.dispose(); }
  188 |   } finally {
  189 |     if (child.exitCode === null) await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill("SIGTERM"); });
  190 |     await rm(directory, { recursive: true, force: true });
  191 |   }
  192 | });
  193 | 
```