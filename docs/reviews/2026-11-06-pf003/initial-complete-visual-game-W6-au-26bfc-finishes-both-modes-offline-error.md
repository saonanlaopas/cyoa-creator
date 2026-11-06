# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: complete-visual-game.spec.ts >> W6 authors, reviews and publishes the complete visual game, restores and duplicates it, and finishes both modes offline
- Location: e2e/complete-visual-game.spec.ts:20:5

# Error details

```
Error: Test timeout of 300000ms exceeded
```

# Page snapshot

```yaml
- generic [ref=f3e2]:
  - link "Skip to main content" [ref=f3e3] [cursor=pointer]:
    - /url: "#main-content"
  - main [ref=f3e4]:
    - generic [ref=f3e5]:
      - article [ref=f3e6]:
        - generic [ref=f3e7]:
          - paragraph [ref=f3e8]: Turn 1
          - heading "A Cup Before the Storm" [level=1] [ref=f3e9]
        - region "World views" [ref=f3e10]:
          - navigation "World views" [ref=f3e11]:
            - button "Explore" [pressed] [ref=f3e12] [cursor=pointer]
            - button "Character" [ref=f3e13] [cursor=pointer]
            - button "Journal" [ref=f3e14] [cursor=pointer]
            - button "Inventory" [ref=f3e15] [cursor=pointer]
            - button "Shops here" [ref=f3e16] [cursor=pointer]
            - button "Give a gift" [ref=f3e17] [cursor=pointer]
          - generic [ref=f3e18]:
            - heading "Explore" [level=3] [ref=f3e19]
            - region "Locations and time" [ref=f3e20]:
              - generic [ref=f3e21]:
                - strong [ref=f3e22]: Keeper's house
                - time [ref=f3e23]: Day 1 · 07:00
              - region "People present" [ref=f3e24]:
                - paragraph [ref=f3e25]: "Here now: No one encountered"
              - region "Chapters and milestones" [ref=f3e26]:
                - paragraph [ref=f3e27]:
                  - strong [ref=f3e28]: Chapter-free play
                - paragraph [ref=f3e29]: "Milestones: None yet"
                - navigation "Events" [ref=f3e30]:
                  - button "Take the warning to the station · 2 min · Prerequisites not met" [disabled] [ref=f3e31]
                  - button "Prepare the honest signal · 3 min · Prerequisites not met" [disabled] [ref=f3e32]
                  - button "Listen to the tide (optional) · 3 min" [ref=f3e33] [cursor=pointer]
                - navigation "Chapter transitions"
              - group [ref=f3e34]:
                - generic "Map" [ref=f3e35] [cursor=pointer]
                - option "Harbor district" [selected]
                - option "Keeper's house"
                - option "Quay cafe"
                - option "Signal station"
              - navigation "Travel" [ref=f3e36]:
                - button "Quay cafe · 7 min" [ref=f3e37] [cursor=pointer]
              - navigation "Local actions"
              - navigation "Wait" [ref=f3e38]:
                - button "Wait 1 min" [ref=f3e39] [cursor=pointer]
                - button "Wait 5 min" [ref=f3e40] [cursor=pointer]
                - button "Wait 15 min" [ref=f3e41] [cursor=pointer]
                - button "Wait 60 min" [ref=f3e42] [cursor=pointer]
                - button "Wait 1440 min" [ref=f3e43] [cursor=pointer]
        - region "Illustrated scene" [ref=f3e44]:
          - generic [ref=f3e45]:
            - figure [ref=f3e46]:
              - img "Red signal tower over blue harbor water" [ref=f3e47]
            - generic:
              - generic:
                - figure "Mira · Concerned":
                  - img "Mira in a green coat with a concerned expression"
          - generic "Dialogue" [ref=f3e48]:
            - paragraph [ref=f3e49]:
              - strong [ref=f3e50]: Mira
              - generic [ref=f3e51]: A truthful signal begins with listening.
          - group [ref=f3e52]:
            - generic "Artwork credits" [ref=f3e53]
        - generic [ref=f3e54]:
          - paragraph [ref=f3e55]: At seven, the harbor is all gulls and pale light. You are Mira, keeper of a signal that has begun to lie. Your neighbor Mara knows the shutter better than anyone. She often visits the quay cafe after quarter past seven.
          - paragraph [ref=f3e56]: Start in Explore. Listening to the tide here is optional. Visit the Quay cafe, buy one Tea in Shops here, wait for Mara if needed, then Give a gift. Your Journal keeps a short guide and your objectives. Reading, maps and menus are free; confirmed activities spend the minutes shown. The story choices below become available after you prepare the signal together.
        - region "Choices" [ref=f3e57]:
          - 'button "Continue Use Explore: share Tea, hear Mara''s warning, carry it to the station, then prepare the signal." [disabled] [ref=f3e58]':
            - generic [ref=f3e59]: Continue
            - generic [ref=f3e60]: "Use Explore: share Tea, hear Mara's warning, carry it to the station, then prepare the signal."
          - button "Hand over the watch (early ending)" [ref=f3e61] [cursor=pointer]
      - complementary "Game status and saves" [ref=f3e63]:
        - region "Game controls" [ref=f3e64]:
          - heading "Game" [level=2] [ref=f3e65]
          - button "Rewind" [disabled] [ref=f3e66]
          - button "Save game" [ref=f3e67] [cursor=pointer]
          - button "Load game" [ref=f3e68] [cursor=pointer]
          - button "Restart" [ref=f3e69] [cursor=pointer]
        - status [ref=f3e70]: New game started.
```

# Test source

```ts
  1   | import { expect, test, type Page, type Locator } from "playwright/test";
  2   | import { randomUUID, createHash } from "node:crypto";
  3   | import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
  4   | import { tmpdir } from "node:os";
  5   | import { join } from "node:path";
  6   | import { pathToFileURL } from "node:url";
  7   | import { createServer } from "node:http";
  8   | import { createRequire } from "node:module";
  9   | import { authorDemo } from "../demos/last-harbor-signal/author.js";
  10  | import { demoHost } from "../demos/last-harbor-signal/host.js";
  11  | import { applyDemoWorld, exportDemo } from "../demos/last-harbor-signal/artifacts.js";
  12  | import { playDemo } from "../demos/last-harbor-signal/play.js";
  13  | const { unzipSync } = createRequire(join(process.cwd(), "apps/server/package.json"))("fflate") as { unzipSync: (b: Uint8Array) => Record<string, Uint8Array> };
  14  | const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  15  | const readSave = (page: Page) => page.evaluate(async () => {
  16  |   const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("story-to-cyoa-native-player-v1", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  17  |   try { return await new Promise<any>((resolve, reject) => { const r = db.transaction("autosaves", "readonly").objectStore("autosaves").getAll(); r.onsuccess = () => resolve(r.result[0]?.value); r.onerror = () => reject(r.error); }); } finally { db.close(); }
  18  | });
  19  | 
  20  | test("W6 authors, reviews and publishes the complete visual game, restores and duplicates it, and finishes both modes offline", async ({ page, browser }, info) => {
  21  |   test.setTimeout(300000); page.setDefaultTimeout(15000);
  22  |   const directory = await mkdtemp(join(tmpdir(), "cyoa-w6-browser-")), projectId = randomUUID(), output = info.outputPath("demo"); await mkdir(output, { recursive: true });
  23  |   const host = await demoHost(directory, projectId); let restored: Awaited<ReturnType<typeof demoHost>> | undefined;
  24  |   const variants: Array<{ mode: string; surface: string; files: Record<string, Uint8Array>; bundle: any; config: any; html?: string }> = [];
  25  |   const manifest: Record<string, any> = { base: "9111866558accd3679921859a688d6831e318a67", projectId, providerCalls: 0, artifacts: [], plays: [] };
  26  |   try {
  27  |     await host.call("create_project", { projectId, operationId: randomUUID(), approved: true, name: "The Last Harbor Signal · W6" });
  28  |     const demo = await authorDemo(host.call, projectId, directory); manifest.assets = demo.assetEvidence;
  29  |     for (const [mode, world] of [["chapter-led", demo.world], ["chapter-free", demo.freeWorld]] as const) {
  30  |       await applyDemoWorld(host, projectId, world);
  31  |       await page.goto(host.address); await page.evaluate((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "world"); localStorage.setItem(`story-to-cyoa.layer.${id}`, "advanced"); localStorage.removeItem(`story-to-cyoa.navigation.${id}`); }, projectId);
  32  |       await page.goto(`${host.address}/?mode=${mode}#long-form`);
  33  |       const editor = page.getByRole("region", { name: "World authoring", exact: true }); await expect(editor.getByLabel("Starting currency", { exact: true })).toHaveValue("6");
  34  |       // A scratch edit is discarded, then the exact authored definition is reviewed and applied in Creator.
  35  |       const result = editor.getByRole("textbox", { name: "Event result 1", exact: true }); await result.fill("Scratch note: do not publish this.");
  36  |       await editor.getByRole("button", { name: "Reload world", exact: true }).click(); await expect(result).toHaveValue(world.progression!.events[0]!.result);
  37  |       await editor.getByRole("button", { name: "Review world", exact: true }).click(); await editor.getByLabel("I approve this exact world and time definition.", { exact: true }).check();
  38  |       await editor.getByRole("button", { name: "Apply world", exact: true }).click(); await expect(editor.getByRole("status")).toHaveText("World applied. Existing builds are unchanged.");
  39  |       for (const [width, height] of [[1280, 900], [390, 844]]) {
  40  |         await page.setViewportSize({ width, height }); await editor.getByRole("heading", { name: "People and schedules", exact: true }).evaluate((el) => window.scrollTo(0, scrollY + el.getBoundingClientRect().top - 100));
  41  |         expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath(`w6-${mode}-creator-${width}.png`) });
  42  |       }
  43  |       await page.setViewportSize({ width: 1280, height: 900 }); await page.getByRole("button", { name: /^Publication/ }).click();
  44  |       await page.getByRole("button", { name: "Compile native bundle", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Native bundle compiled and runtime-loaded" })).toBeVisible();
  45  |       await page.getByRole("button", { name: "Play current build", exact: true }).click(); await expect(page.getByRole("heading", { name: "A Cup Before the Storm", exact: true })).toBeVisible();
  46  |       await page.screenshot({ path: info.outputPath(`w6-${mode}-creator-preview.png`), fullPage: true });
  47  |       const artifact = await exportDemo(host, projectId, output, mode); manifest.artifacts.push(...artifact.artifacts);
  48  |       await writeFile(join(output, `${mode}-world.json`), JSON.stringify((await host.call("read_world", { projectId })).world, null, 2) + "\n");
  49  |       const files = unzipSync(await readFile(join(output, `${mode}.zip`))), bundle = JSON.parse(Buffer.from(files["game.json"]!).toString()), config = JSON.parse(Buffer.from(files["player-config.json"]!).toString()), zipManifest = JSON.parse(Buffer.from(files["manifest.json"]!).toString());
  50  |       for (const [name, hash] of Object.entries(zipManifest.files)) expect(sha(files[name]!)).toBe(hash);
  51  |       const pictures = [...bundle.illustratedPresentation.assets, ...bundle.world.assets]; expect(pictures).toHaveLength(5);
  52  |       expect(pictures.every((p) => p.dataUrl.startsWith("data:image/") && p.license === "CC0")).toBe(true);
  53  |       expect(pictures.map((p) => sha(Buffer.from(p.dataUrl.split(",")[1], "base64"))).sort()).toEqual(demo.assetEvidence.map((a) => a.approvedSha256).sort());
  54  |       expect(bundle.illustratedPresentation.scenes).toHaveLength(9);
  55  |       variants.push({ mode, surface: "standalone", files, bundle, config, html: join(output, `${mode}.html`) }, { mode, surface: "static", files, bundle, config });
  56  |     }
  57  |     // Restore an actual verified source backup in a separate database and compile via the restored MCP boundary.
  58  |     restored = await demoHost(directory, projectId, "restored.sqlite");
  59  |     const form = new FormData(); form.set("file", new Blob([await readFile(join(output, "chapter-led.cyoa-backup.zip"))], { type: "application/zip" }), "w6.cyoa-backup.zip");
  60  |     await restored.response("/api/recovery/backups/restore", { method: "POST", body: form });
  61  |     const restoredArtifact = await exportDemo(restored, projectId, output, "restored"), restoredFiles = unzipSync(await readFile(join(output, "restored.zip"))), restoredBundle = JSON.parse(Buffer.from(restoredFiles["game.json"]!).toString());
  62  |     expect(restoredBundle).toEqual(variants[0]!.bundle); manifest.restoredBundleEqualsOriginal = true;
  63  |     const copy = await restored.json(`/api/projects/${projectId}/duplicate`, { name: "Independent W6 visual game" });
  64  |     const copied = await restored.json(`/api/long-form/projects/${copy.id}/publication/compile`, {});
  65  |     expect(playDemo(copied.bundle, copied.playerConfig).final.state).toEqual(playDemo(restoredBundle, variants[0]!.config).final.state);
  66  |     const copiedZip = Buffer.from(await (await restored.response(`/api/long-form/projects/${copy.id}/publication/exports/static`)).arrayBuffer()); await writeFile(join(output, "duplicate.zip"), copiedZip);
  67  |     const copiedFiles = unzipSync(copiedZip);
  68  |     variants.push({ mode: "restored", surface: "static", files: restoredFiles, bundle: restoredBundle, config: JSON.parse(Buffer.from(restoredFiles["player-config.json"]!).toString()) }, { mode: "duplicate", surface: "static", files: copiedFiles, bundle: copied.bundle, config: copied.playerConfig });
  69  |     manifest.duplicate = { projectId: copy.id, bundleFingerprint: copied.bundle.bundleFingerprint, finalStateEqualsOriginal: true }; manifest.artifacts.push(...restoredArtifact.artifacts, { file: "duplicate.zip", sha256: sha(copiedZip), bytes: copiedZip.length });
  70  |     manifest.operationNames = [...host.calls, ...restored.calls];
  71  |     await host.close(); await restored.close(); manifest.creatorStoppedBeforePlay = true;
  72  |     const server = createServer((req, res) => {
  73  |       const parts = (req.url ?? "").split("/"), variant = variants.find((v) => v.mode === parts[1] && v.surface === "static"), path = parts.slice(2).join("/"), bytes = variant?.files[path];
  74  |       if (!bytes) { res.writeHead(404); res.end(); return; } res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "text/html"); res.end(Buffer.from(bytes));
  75  |     });
  76  |     await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const addr = server.address(); const origin = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  77  |     try {
  78  |       for (const variant of variants) for (const [width, height] of variant.mode === "restored" || variant.mode === "duplicate" ? [[390, 844]] : [[1280, 900], [390, 844]]) {
  79  |         const context = await browser.newContext({ viewport: { width, height } }), player = await context.newPage(), requests: string[] = [], pageErrors: string[] = [];
  80  |         player.setDefaultTimeout(15000); player.on("request", (r) => requests.push(r.url())); player.on("pageerror", (e) => pageErrors.push(e.message));
  81  |         try {
  82  |           await player.goto(variant.surface === "standalone" ? pathToFileURL(variant.html!).href : `${origin}/${variant.mode}/index.html`);
  83  |           const expected = playDemo(variant.bundle, variant.config), views = player.getByRole("region", { name: "World views", exact: true }), nav = player.getByRole("navigation", { name: "World views", exact: true });
  84  |           const show = async (name: string) => { await nav.getByRole("button", { name, exact: true }).click(); };
  85  |           const confirm = async (button: Locator) => { await button.click(); await player.getByRole("button", { name: "Confirm action", exact: true }).click(); await expect(player.getByRole("button", { name: "Confirm action", exact: true })).toHaveCount(0); };
  86  |           const imageReady = async () => {
> 87  |             await player.evaluate(() => document.fonts.ready); for (const img of await player.locator(".illustrated-scene img").all()) await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      |                                                                                                                                                                                                                                            ^ Error: Test timeout of 300000ms exceeded
  88  |             const geometry = await player.locator(".scene-stage").evaluate((el) => { const r = el.getBoundingClientRect(); return [...el.querySelectorAll(".scene-portrait,img,figcaption")].filter((node) => node.closest(".scene-portrait")).every((node) => { const b = node.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1; }); }); expect(geometry).toBe(true);
  89  |             expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  90  |           };
  91  |           await expect(views.getByLabel("Game time")).toHaveText("Day 1 · 07:00"); await imageReady();
  92  |           await nav.getByRole("button", { name: "Explore", exact: true }).focus(); await player.keyboard.press("Tab"); await expect(nav.getByRole("button", { name: "Character", exact: true })).toBeFocused(); await player.keyboard.press("Space"); await expect(views.getByRole("heading", { name: "Character", level: 3 })).toBeFocused();
  93  |           await expect(player.locator(".illustrated-scene")).toHaveCount(0); await expect(views.getByText("Trust with Mara", { exact: true })).toBeVisible(); await player.keyboard.press("Escape"); await expect(nav.getByRole("button", { name: "Explore", exact: true })).toBeFocused();
  94  |           await show("Journal"); await views.getByRole("button", { name: "Entries", exact: true }).click(); await expect(views.getByRole("heading", { name: "A note for the morning", exact: true })).toBeVisible(); await expect(views.getByRole("heading", { name: "The cracked shutter", exact: true })).toHaveCount(0); await player.keyboard.press("Escape");
  95  |           await views.getByRole("button", { name: "Listen to the tide (optional) · 3 min", exact: true }).click(); await player.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(views.getByLabel("Game time")).toHaveText("Day 1 · 07:00"); expect(await readSave(player)).toBeUndefined();
  96  |           await confirm(views.getByRole("button", { name: "Listen to the tide (optional) · 3 min", exact: true }));
  97  |           await views.getByText("Map", { exact: true }).click(); await views.getByRole("button", { name: "Inspect Quay cafe", exact: true }).click(); await expect(views.getByRole("region", { name: "Destination", exact: true })).toContainText("Quay cafe"); await imageReady();
  98  |           await player.screenshot({ path: info.outputPath(`w6-${variant.mode}-${variant.surface}-${width}-explore.png`), fullPage: true });
  99  |           await confirm(views.getByRole("navigation", { name: "Travel", exact: true }).getByRole("button", { name: "Quay cafe · 7 min", exact: true }));
  100 |           await expect(views.getByRole("region", { name: "People present", exact: true })).toContainText("No one encountered"); await show("Give a gift"); await expect(views.getByText("No authored gifts for anyone here.", { exact: true })).toBeVisible();
  101 |           await show("Shops here"); expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  102 |           if (variant.mode === "chapter-led" && variant.surface === "standalone" && width === 1280) await player.screenshot({ path: info.outputPath("w6-chapter-led-standalone-1280-shop.png"), fullPage: true });
  103 |           await confirm(views.getByRole("button", { name: "Buy 1 Tea · 3 Coins · 2 min", exact: true })); await expect(views.getByText("Out of stock", { exact: true })).toBeVisible();
  104 |           await show("Explore"); await confirm(views.getByRole("button", { name: "Wait 5 min", exact: true })); await expect(views.getByRole("region", { name: "People present", exact: true })).toContainText("Mara");
  105 |           await show("Give a gift"); expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  106 |           if (variant.mode === "chapter-free" && variant.surface === "static" && width === 390) await player.screenshot({ path: info.outputPath("w6-chapter-free-static-390-gift.png"), fullPage: true });
  107 |           await confirm(views.getByRole("button", { name: /^Share a warm cup · 1 Tea to Mara · 1 min/ })); await show("Explore"); await expect(views).toContainText("Required encounter: Hear Mara's warning"); await expect(views.getByRole("button", { name: "Wait 5 min", exact: true })).toBeDisabled();
  108 |           await imageReady(); await player.screenshot({ path: info.outputPath(`w6-${variant.mode}-${variant.surface}-${width}-encounter.png`), fullPage: true });
  109 |           await confirm(views.getByRole("button", { name: "Hear Mara's warning · 5 min", exact: true })); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.afterWarning.state);
  110 |           await player.getByRole("button", { name: "Save game", exact: true }).click(); await player.getByLabel("Save name", { exact: true }).fill("Mara's warning"); await player.getByRole("button", { name: "Create save", exact: true }).click();
  111 |           await expect(player.getByRole("status").filter({ hasText: /^Saved “Mara's warning”\.$/ })).toBeVisible();
  112 |           await player.reload(); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.afterWarning.state);
  113 |           const finish = async () => { await show("Explore"); await confirm(views.getByRole("button", { name: variant.bundle.world.progression.chapters.length ? "Begin II · An honest light · 2 min" : "Take the warning to the station · 2 min", exact: true })); await confirm(views.getByRole("button", { name: "Prepare the honest signal · 3 min", exact: true })); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.prepared.state); };
  114 |           await finish(); await expect(views.getByRole("region", { name: "People present", exact: true })).toContainText("Mara"); await show("Character"); await expect(views.getByRole("definition")).toHaveText("3");
  115 |           await show("Journal"); await views.getByRole("button", { name: "Objectives", exact: true }).click(); await expect(views.getByRole("region", { name: "Objectives", exact: true })).toContainText("No active objectives disclosed."); await expect(views.getByRole("region", { name: "Objectives", exact: true })).toContainText("Completed objectives");
  116 |           await player.screenshot({ path: info.outputPath(`w6-${variant.mode}-${variant.surface}-${width}-journal.png`), fullPage: true });
  117 |           await show("Explore"); await imageReady(); await player.getByRole("button", { name: "Light the honest signal", exact: true }).click(); await expect(player.getByRole("heading", { name: "The Honest Signal", exact: true })).toBeVisible(); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.final.state); await imageReady();
  118 |           await player.screenshot({ path: info.outputPath(`w6-${variant.mode}-${variant.surface}-${width}-ending.png`), fullPage: true });
  119 |           await player.reload(); await expect(player.getByRole("heading", { name: "The Honest Signal", exact: true })).toBeVisible();
  120 |           await player.getByRole("button", { name: "Rewind", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.prepared.state); await player.getByRole("button", { name: "Light the honest signal", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.final.state);
  121 |           await player.getByRole("button", { name: "Load game", exact: true }).click(); await player.getByRole("button", { name: "Load", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.afterWarning.state); await finish(); await player.getByRole("button", { name: "Light the honest signal", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.final.state);
  122 |           const state = (await readSave(player)).state; expect(state.world.economy.currency).toBe(3); expect(state.relationships[demo.trust]).toBe(3); expect(state.world.journal.completedObjectiveIds).toEqual(["cup", "signal", "warning"]); expect(state.world.journal.entryIds).toEqual(["guide", "memory", "ready", "warning"]); expect(state.world.minutes).toBe(448);
  123 |           const stateFile = `w6-${variant.mode}-${variant.surface}-${width}-state.json`; await writeFile(info.outputPath(stateFile), JSON.stringify(state, null, 2) + "\n");
  124 |           if (width === 390 && (variant.mode === "chapter-led" && variant.surface === "static" || variant.mode === "chapter-free" && variant.surface === "standalone")) {
  125 |             await player.getByRole("button", { name: "Rewind", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.prepared.state);
  126 |             await player.getByRole("button", { name: "Share the watch", exact: true }).click(); await expect(views.getByRole("region", { name: "People present", exact: true })).toContainText("Mara");
  127 |             const sharedExit = variant.bundle.choices.find((c: any) => c.id === "choice-passage-route-2-act-ending-2").text;
  128 |             await player.getByRole("button", { name: sharedExit, exact: true }).click(); await expect(player.getByRole("heading", { name: "A Shared Repair", exact: true })).toBeVisible();
  129 |             const sharedState = (await readSave(player)).state; expect(sharedState.world.locationId).toBe("station"); expect(sharedState.currentPassageId).toBe("passage-ending-2"); await imageReady();
  130 |             await player.screenshot({ path: info.outputPath(`w6-${variant.mode}-${variant.surface}-${width}-shared-ending.png`), fullPage: true });
  131 |             await player.getByRole("button", { name: "Restart", exact: true }).click(); await player.getByRole("button", { name: "Restart game", exact: true }).click();
  132 |             await player.getByRole("button", { name: "Hand over the watch (early ending)", exact: true }).click(); await player.getByRole("button", { name: "Finish the handover", exact: true }).click();
  133 |             await expect(player.getByRole("heading", { name: "The Unfinished Watch", exact: true })).toBeVisible(); const earlyState = (await readSave(player)).state; expect(earlyState.currentPassageId).toBe("passage-ending-3"); expect(earlyState.world.journal.completedObjectiveIds).toEqual([]);
  134 |             manifest.alternateEndings ??= []; manifest.alternateEndings.push({ mode: variant.mode, surface: variant.surface, width, sharedEndingId: "ending-2", sharedLocation: "station", earlyEndingId: "ending-3", earlyObjectives: [] });
  135 |           }
  136 |           expect(pageErrors).toEqual([]); expect(requests.filter((u) => /\/api\/|openrouter|provider/i.test(u) || /^https?:/.test(u) && !u.startsWith(origin))).toEqual([]);
  137 |           manifest.plays.push({ mode: variant.mode, surface: variant.surface, width, stateFile, finalStateSha256: sha(Buffer.from(JSON.stringify(state))), requests, pageErrors });
  138 |         } finally { await context.close(); }
  139 |       }
  140 |     } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  141 |     await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  142 |   } finally { await host.close(); await restored?.close(); await rm(directory, { recursive: true, force: true }); }
  143 | });
  144 | 
```