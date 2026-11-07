import { expect, test } from "playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { largeBible, largeRoutes } from "./helpers/large-foundations.js";

test("PF-001 creates and edits bounded records in large foundations through Creator and reconnecting MCP", async ({ page, playwright }, info) => {
  test.setTimeout(180000);
  const directory = await mkdtemp(join(tmpdir(), "cyoa-pf001-")), id = randomUUID(), token = randomBytes(32).toString("hex");
  const databasePath = join(directory, "fixture.sqlite"), captures = info.outputPath("mock-provider-requests.json");
  const require = createRequire(join(process.cwd(), "apps/server/package.json"));
  const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
  const { StreamableHTTPClientTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js")).href);
  let child: ChildProcess | undefined, address = "", client: any, request: any, sql: DatabaseSync | undefined;
  const evidence: any = { sdkTransport: "authenticated HTTP; native desktop discovery is separate", requests: [], cases: [] };
  async function start() {
    child = spawn(process.execPath, ["e2e/helpers/large-foundation-server.mjs"], { env: { PATH: process.env.PATH, NODE_ENV: "test", CYOA_MCP_TOKEN: token, PF001_PROJECT: id, PF001_DATABASE: databasePath, PF001_CAPTURE: captures }, stdio: ["ignore", "pipe", "pipe"] });
    let errors = ""; child.stderr!.on("data", c => { errors += String(c); });
    address = await new Promise<string>((resolve, reject) => { let output = ""; const timer = setTimeout(() => reject(new Error(`PF001 startup: ${errors}`)), 10000);
      child!.stdout!.on("data", c => { output += String(c); for (const line of output.split("\n")) try { const data = JSON.parse(line); if (data.address) { clearTimeout(timer); resolve(data.address); } } catch { /* Wait for the complete startup record. */ } });
      child!.once("exit", () => { clearTimeout(timer); reject(new Error(`PF001 exited: ${errors}`)); }); });
    request = await playwright.request.newContext({ baseURL: address });
    client = new Client({ name: "PF001-browser-acceptance", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(address + "/mcp"), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    sql = new DatabaseSync(databasePath, { readOnly: true });
  }
  async function stop() { sql?.close(); sql = undefined; await client?.close(); client = undefined; await request?.dispose(); request = undefined;
    if (child?.exitCode === null) await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("PF001 shutdown timeout")), 10000); child!.once("exit", () => { clearTimeout(timer); resolve(); }); child!.kill("SIGTERM"); }); }
  async function api(method: string, path: string, data?: unknown) { const r = await request.fetch(path, { method, ...(data === undefined ? {} : { data }) }); expect(r.ok(), await r.text()).toBe(true); return r.json(); }
  const root = `/api/long-form/projects/${id}`;
  const state = () => api("GET", root);
  const rows = () => { const tables = sql!.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
    return createHash("sha256").update(JSON.stringify(tables.map(({ name }) => [name, sql!.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]))).digest("hex"); };
  const raw = async (name: string, args: any = {}) => client.callTool({ name, arguments: { projectId: id, ...args } });
  const call = async (name: string, args: any = {}) => { const r = await raw(name, args); expect(r.isError, JSON.stringify(r)).not.toBe(true); return r.structuredContent; };
  async function prepare(keys: string[]) { const head = await call("project_state"), s = await state(); const args = { operationId: randomUUID(), message: "Add or edit only the reviewed investigation records.", headFingerprint: head.headFingerprint,
    targets: keys.map(key => ({ key, versionId: s[key.startsWith("collection:") ? key.split(":")[1]! : key.split(":")[0]!].id })) };
    const result = await call("prepare_edit", args); evidence.requests.push({ tool: "prepare_edit", args, plan: result.plan, contextBytes: result.plan.contextBytes }); return { args, result }; }
  async function submit(prepared: any, operations: any[]) { const args = { operationId: randomUUID(), planId: prepared.result.plan.id, fingerprint: prepared.result.plan.fingerprint, response: { message: "Review the exact requested records", groups: [{ id: "requested", label: "Requested investigation change", explanation: "Preserve all unrelated work", dependsOnGroupIds: [], operations }] } };
    const result = await call("submit_edit", args); expect(await call("submit_edit", args)).toEqual(result); return { ...result, retainedEnvelope: args }; }
  async function apply(proposalId: string) { const r = await call("review_edit", { proposalId, groupIds: ["requested"] }); expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThan(256000);
    const args = { operationId: randomUUID(), proposalId, groupIds: ["requested"], fingerprint: r.fingerprint, approved: true }; const result = await call("apply_edit", args); expect(await call("apply_edit", args)).toEqual(result); evidence.lastMcpApply = { args, result }; return r; }
  async function open() { await page.goto(address + "/api/health"); await page.evaluate(projectId => { localStorage.setItem("story-to-cyoa.long-form-project-id", projectId); localStorage.setItem("story-to-cyoa.long-form-stage", "editing"); }, id); await page.goto(address + "/#long-form"); }
  async function browserProposal(keys: string[], message: string) { await open();
    for (const key of keys) { await page.getByLabel("Find planning records").fill(key); await page.getByRole("checkbox", { name: new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }).check(); }
    await page.getByLabel("Editing request", { exact: true }).fill(message); await page.getByRole("button", { name: "Preview editing scope", exact: true }).click();
    const auth = page.getByRole("checkbox", { name: "Authorize this exact editing generation" }); await auth.focus(); await page.keyboard.press("Space"); await expect(auth).toBeChecked();
    await page.getByRole("button", { name: "Generate editing response", exact: true }).click(); await expect(page.getByRole("region", { name: "Editing proposal", exact: true })).toBeVisible(); }
  async function browserReview() { const response = page.waitForResponse(r => r.url().endsWith("/review") && r.request().method() === "POST"); await page.getByRole("button", { name: "Review selected changes", exact: true }).click(); const review = await (await response).json(); expect(Buffer.byteLength(JSON.stringify(review))).toBeLessThan(256000); return review; }
  async function browserApply() { const button = page.getByRole("button", { name: "Apply selected editing changes", exact: true }); await button.focus(); await page.keyboard.press("Enter"); await expect(page.getByRole("status").filter({ hasText: "Selected changes applied as draft versions" })).toBeVisible(); }
  try {
    await start();
    const initial = await state(); for (const owner of ["brief", "creative-direction"]) await api("POST", root + "/" + owner + "/approve", { versionId: owner === "brief" ? initial.brief.id : initial.creativeDirection.id });
    for (const owner of ["bible", "routes", "endings", "mechanics"]) { let v = (await api("POST", root + "/" + owner))[owner];
      if (owner === "bible") v = (await api("PUT", root + "/bible", largeBible(v.content, 3))).bible;
      if (owner === "routes") v = (await api("PUT", root + "/routes", largeRoutes(v.content, 5))).routes;
      if (owner === "mechanics") v = (await api("PUT", root + "/mechanics", { ...v.content, choiceEffectPlans: [{ id: "effect-use", label: "Declared usage", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: [...v.content.visibleStats, ...v.content.relationships].map((x: any) => x.key), effectGuidance: ["Carry the authored investigation consequences into choices."] }] })).mechanics;
      await api("POST", root + "/" + owner + "/approve", { versionId: v.id }); }
    const before = await state(); evidence.rootBytes = { bible: Buffer.byteLength(JSON.stringify(before.bible.content)), routes: Buffer.byteLength(JSON.stringify(before.routes.content)) };
    expect(evidence.rootBytes.bible).toBeGreaterThan(256000); expect(evidence.rootBytes.routes).toBeGreaterThan(256000);
    for (const owner of ["bible", "routes"]) { const snapshot = rows(), response = await request.post(root + "/editing/preview", { data: { message: "Add a new planning record", targetKeys: [owner + ":root"] } }); expect(response.status()).toBe(409); expect(await response.json()).toEqual({ error: "edit_context_overflow_narrow_scope" }); expect(rows()).toBe(snapshot);
      const head = await call("project_state"), keys = owner === "bible" ? ["bible:root"] : ["routes:root", "routes:decision-route-selection", ...before.routes.content.endingHooks.map((h: any) => `routes:${h.id}`)];
      const rejected = await raw("prepare_edit", { operationId: randomUUID(), message: "Add a new planning record", headFingerprint: head.headFingerprint, targets: keys.map(key => ({ key, versionId: before[owner].id })) });
      expect(rejected.isError).toBe(true); expect(JSON.stringify(rejected)).toContain("edit_context_overflow_narrow_scope"); expect(rows()).toBe(snapshot); evidence.cases.push({ owner, rootRejected: true, unchanged: true }); }
    expect(JSON.parse(await readFile(captures, "utf8").catch(() => "[]"))).toEqual([]);
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    await browserProposal(["collection:bible:characters"], "Create an inspection witness"); expect((await state()).bible.id).toBe(before.bible.id);
    const witnessReview = await browserReview(); evidence.witnessReview = witnessReview; expect(witnessReview.outputs[0].after.addedRecords[0].name).toBe("Inspection witness"); expect(witnessReview.outputs[0].after.existingRecordsUnchanged).toBe(true);
    await page.getByRole("region", { name: "Effective editing changes" }).getByText("bible / collection:characters: before and after", { exact: true }).click();
    for (const width of [1280, 390]) { await page.setViewportSize({ width, height: 900 }); await page.getByRole("region", { name: "Effective editing changes" }).scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath(`bible-review-${width}.png`), fullPage: true }); }
    await browserApply(); let current = await state(), witness = current.bible.content.characters.at(-1); expect(current.bible.content.characters.slice(0, -1)).toEqual(before.bible.content.characters);
    const edited = await submit(await prepare([`bible:${witness.id}`]), [{ targetKey: `bible:${witness.id}`, kind: "set-fields", changes: { name: "Reviewed witness" } }]); await apply(edited.proposalId);
    const pending = await prepare(["collection:bible:relationships", `bible:${witness.id}`, "bible:person-0"]), oldPlan = pending.result.plan;
    await stop(); await start(); expect((await call("prepare_edit", pending.args)).plan).toEqual(oldPlan); evidence.reconnected = true;
    const relationship = await submit(pending, [{ targetKey: "collection:bible:relationships", kind: "add-item", collection: "relationships", item: { id: "$new:witness-bond", characterIds: [witness.id, "person-0"], label: "Inspection partnership", currentState: "Trust depends on attribution.", plannedArc: "Corroborate the disputed record." } }]);
    const { retainedEnvelope, ...retainedSubmission } = relationship, submittedState = rows();
    await stop(); await start(); expect(await call("submit_edit", retainedEnvelope)).toEqual(retainedSubmission); expect(rows()).toBe(submittedState); evidence.submitReconnected = true;
    await open(); await page.locator(".bootstrap-detail").filter({ hasText: /^proposed \/ / }).getByRole("button", { name: "Open saved proposal", exact: true }).click(); await browserReview(); await browserApply();
    current = await state(); const bond = current.bible.content.relationships.at(-1); expect(bond.characterIds).toEqual([witness.id, "person-0"]);
    await apply((await submit(await prepare([`bible:${bond.id}`]), [{ targetKey: `bible:${bond.id}`, kind: "set-fields", changes: { label: "Reviewed partnership" } }])).proposalId);
    await browserProposal([`bible:${witness.id}`], "Rename the reviewed witness"); await browserReview(); await browserApply();
    await browserProposal(["collection:routes:decisionPoints", "routes:shared-route-pivot"], "Create an inspection decision"); const decisionReview = await browserReview(); evidence.decisionReview = decisionReview;
    expect(decisionReview.outputs[0].after.addedRecords[0].choices).toHaveLength(2);
    await page.getByRole("region", { name: "Effective editing changes" }).getByText("routes / collection:decisionPoints: before and after", { exact: true }).click();
    for (const width of [1280, 390]) { await page.setViewportSize({ width, height: 900 }); await page.screenshot({ path: info.outputPath(`routes-review-${width}.png`), fullPage: true }); }
    await browserApply(); current = await state(); const first = current.routes.content.decisionPoints.at(-1);
    await apply((await submit(await prepare([`routes:${first.id}`, `routes:${first.choices[0].id}`]), [{ targetKey: `routes:${first.id}`, kind: "set-fields", changes: { question: "Which corroborated account should be recorded?" } }, { targetKey: `routes:${first.choices[0].id}`, kind: "set-fields", changes: { label: "Record corroborated testimony" } }])).proposalId);
    const second = { ...first, id: "$new:second-decision", label: "Second review", choices: first.choices.map((c: any, i: number) => ({ ...c, id: `$new:second-choice-${i}` })) };
    await apply((await submit(await prepare(["collection:routes:decisionPoints", "routes:shared-route-pivot"]), [{ targetKey: "collection:routes:decisionPoints", kind: "add-item", collection: "decisionPoints", item: second }])).proposalId);
    const retainedApply = evidence.lastMcpApply, appliedState = rows();
    await stop(); await start(); expect(await call("apply_edit", retainedApply.args)).toEqual(retainedApply.result); expect(rows()).toBe(appliedState); evidence.applyReconnected = true;
    current = await state(); const secondRecord = current.routes.content.decisionPoints.at(-1);
    await browserProposal([`routes:${secondRecord.id}`, `routes:${secondRecord.choices[0].id}`], "Refine the second decision and its first choice"); await browserReview(); await browserApply();
    const invalid = await prepare(["collection:bible:relationships"]), invalidBefore = rows(); const rejected = await raw("submit_edit", { operationId: randomUUID(), planId: invalid.result.plan.id, fingerprint: invalid.result.plan.fingerprint, response: { message: "Invalid reference probe", groups: [{ id: "bad", label: "Invalid", explanation: "Must reject", dependsOnGroupIds: [], operations: [{ targetKey: "collection:bible:relationships", kind: "add-item", collection: "relationships", item: { id: "$new:bad", characterIds: [witness.id, "missing-person"], label: "Invalid", currentState: "", plannedArc: "" } }] }] } });
    expect(rejected.isError).toBe(true); expect(rows()).toBe(invalidBefore); evidence.invalidReference = rejected;
    const stale = await submit(await prepare([`bible:${witness.id}`]), [{ targetKey: `bible:${witness.id}`, kind: "set-fields", changes: { name: "Must never apply" } }]);
    await open(); await page.locator(".bootstrap-detail").filter({ hasText: /^proposed \/ / }).getByRole("button", { name: "Open saved proposal", exact: true }).click(); await browserReview();
    await apply((await submit(await prepare([`routes:${secondRecord.id}`]), [{ targetKey: `routes:${secondRecord.id}`, kind: "set-fields", changes: { question: "An intervening reviewed change" } }])).proposalId);
    const staleBefore = rows(); await page.getByRole("button", { name: "Apply selected editing changes", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("edit_base_stale_repreview"); expect(rows()).toBe(staleBefore);
    await call("reject_edit", { operationId: randomUUID(), proposalId: stale.proposalId }); evidence.staleRejected = true;
    current = await state(); expect(current.bible.content.characters.slice(0, -1)).toEqual(before.bible.content.characters); expect(current.bible.content.relationships.slice(0, -1)).toEqual(before.bible.content.relationships); expect(current.routes.content.decisionPoints.slice(0, -2)).toEqual(before.routes.content.decisionPoints);
    for (const owner of ["bible", "routes"]) for (const [field, value] of Object.entries(before[owner].content)) if (!(owner === "bible" ? ["characters", "relationships"] : ["decisionPoints"]).includes(field)) expect(current[owner].content[field]).toEqual(value);
    for (const owner of ["brief", "creativeDirection", "endings", "mechanics"]) expect(current[owner].content).toEqual(before[owner].content);
    evidence.finalRecords = { witness: current.bible.content.characters.at(-1), relationship: current.bible.content.relationships.at(-1), decisions: current.routes.content.decisionPoints.slice(-2) }; evidence.unrelatedRecordsUnchanged = true;
    const generated = JSON.parse(await readFile(captures, "utf8")); expect(generated).toHaveLength(4); for (const c of generated) { expect(c.authoringInstructions.enabled).toBe(true); expect(Buffer.byteLength(JSON.stringify(c.messages))).toBeLessThan(64000); }
    evidence.offlineMockCalls = generated.length; evidence.paidProviderCalls = 0;
    await page.context().tracing.stop({ path: info.outputPath("collection-workflow.zip") });
    await writeFile(info.outputPath("acceptance.json"), JSON.stringify(evidence, null, 2) + "\n");
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});
