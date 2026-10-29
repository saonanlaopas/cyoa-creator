import { expect, test, type Page, type Locator } from "playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { authorDemo } from "../demos/last-harbor-signal/author.js";
import { demoHost } from "../demos/last-harbor-signal/host.js";
import { applyDemoWorld, exportDemo } from "../demos/last-harbor-signal/artifacts.js";
import { playDemo } from "../demos/last-harbor-signal/play.js";
const { unzipSync } = createRequire(join(process.cwd(), "apps/server/package.json"))("fflate") as { unzipSync: (b: Uint8Array) => Record<string, Uint8Array> };
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const readSave = (page: Page) => page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("story-to-cyoa-native-player-v1", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try { return await new Promise<any>((resolve, reject) => { const r = db.transaction("autosaves", "readonly").objectStore("autosaves").getAll(); r.onsuccess = () => resolve(r.result[0]?.value); r.onerror = () => reject(r.error); }); } finally { db.close(); }
});

test("W6 authors, reviews and publishes the complete visual game, restores and duplicates it, and finishes both modes offline", async ({ page, browser }, info) => {
  test.setTimeout(300000); page.setDefaultTimeout(15000);
  const directory = await mkdtemp(join(tmpdir(), "cyoa-w6-browser-")), projectId = randomUUID(), output = info.outputPath("demo"); await mkdir(output, { recursive: true });
  const host = await demoHost(directory, projectId); let restored: Awaited<ReturnType<typeof demoHost>> | undefined;
  const variants: Array<{ mode: string; surface: string; files: Record<string, Uint8Array>; bundle: any; config: any; html?: string }> = [];
  const manifest: Record<string, any> = { base: "9111866558accd3679921859a688d6831e318a67", projectId, providerCalls: 0, artifacts: [], plays: [] };
  try {
    await host.call("create_project", { projectId, operationId: randomUUID(), approved: true, name: "The Last Harbor Signal · W6" });
    const demo = await authorDemo(host.call, projectId, directory); manifest.assets = demo.assetEvidence;
    for (const [mode, world] of [["chapter-led", demo.world], ["chapter-free", demo.freeWorld]] as const) {
      await applyDemoWorld(host, projectId, world);
      await page.goto(host.address); await page.evaluate((id) => { localStorage.setItem("story-to-cyoa.long-form-project-id", id); localStorage.setItem("story-to-cyoa.long-form-stage", "world"); localStorage.setItem(`story-to-cyoa.layer.${id}`, "advanced"); localStorage.removeItem(`story-to-cyoa.navigation.${id}`); }, projectId);
      await page.goto(`${host.address}/?mode=${mode}#long-form`);
      const editor = page.getByRole("region", { name: "World authoring", exact: true }); await expect(editor.getByLabel("Starting currency", { exact: true })).toHaveValue("6");
      // A scratch edit is discarded, then the exact authored definition is reviewed and applied in Creator.
      const result = editor.getByRole("textbox", { name: "Event result 1", exact: true }); await result.fill("Scratch note: do not publish this.");
      await editor.getByRole("button", { name: "Reload world", exact: true }).click(); await expect(result).toHaveValue(world.progression!.events[0]!.result);
      await editor.getByRole("button", { name: "Review world", exact: true }).click(); await editor.getByLabel("I approve this exact world and time definition.", { exact: true }).check();
      await editor.getByRole("button", { name: "Apply world", exact: true }).click(); await expect(editor.getByRole("status")).toHaveText("World applied. Existing builds are unchanged.");
      for (const [width, height] of [[1280, 900], [390, 844]]) {
        await page.setViewportSize({ width, height }); await editor.getByRole("heading", { name: "People and schedules", exact: true }).evaluate((el) => window.scrollTo(0, scrollY + el.getBoundingClientRect().top - 100));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath(`w6-${mode}-creator-${width}.png`) });
      }
      await page.setViewportSize({ width: 1280, height: 900 }); await page.getByRole("button", { name: /^Publication/ }).click();
      await page.getByRole("button", { name: "Compile native bundle", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Native bundle compiled and runtime-loaded" })).toBeVisible();
      await page.getByRole("button", { name: "Play current build", exact: true }).click(); await expect(page.getByRole("heading", { name: "A Cup Before the Storm", exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`w6-${mode}-creator-preview.png`), fullPage: true });
      const artifact = await exportDemo(host, projectId, output, mode); manifest.artifacts.push(...artifact.artifacts);
      await writeFile(join(output, `${mode}-world.json`), JSON.stringify((await host.call("read_world", { projectId })).world, null, 2) + "\n");
      const files = unzipSync(await readFile(join(output, `${mode}.zip`))), bundle = JSON.parse(Buffer.from(files["game.json"]!).toString()), config = JSON.parse(Buffer.from(files["player-config.json"]!).toString()), zipManifest = JSON.parse(Buffer.from(files["manifest.json"]!).toString());
      for (const [name, hash] of Object.entries(zipManifest.files)) expect(sha(files[name]!)).toBe(hash);
      const pictures = [...bundle.illustratedPresentation.assets, ...bundle.world.assets]; expect(pictures).toHaveLength(5);
      expect(pictures.every((p) => p.dataUrl.startsWith("data:image/") && p.license === "CC0")).toBe(true);
      expect(pictures.map((p) => sha(Buffer.from(p.dataUrl.split(",")[1], "base64"))).sort()).toEqual(demo.assetEvidence.map((a) => a.approvedSha256).sort());
      expect(bundle.illustratedPresentation.scenes).toHaveLength(9);
      variants.push({ mode, surface: "standalone", files, bundle, config, html: join(output, `${mode}.html`) }, { mode, surface: "static", files, bundle, config });
    }
    // Restore an actual verified source backup in a separate database and compile via the restored MCP boundary.
    restored = await demoHost(directory, projectId, "restored.sqlite");
    const form = new FormData(); form.set("file", new Blob([await readFile(join(output, "chapter-led.cyoa-backup.zip"))], { type: "application/zip" }), "w6.cyoa-backup.zip");
    await restored.response("/api/recovery/backups/restore", { method: "POST", body: form });
    const restoredArtifact = await exportDemo(restored, projectId, output, "restored"), restoredFiles = unzipSync(await readFile(join(output, "restored.zip"))), restoredBundle = JSON.parse(Buffer.from(restoredFiles["game.json"]!).toString());
    expect(restoredBundle).toEqual(variants[0]!.bundle); manifest.restoredBundleEqualsOriginal = true;
    const copy = await restored.json(`/api/projects/${projectId}/duplicate`, { name: "Independent W6 visual game" });
    const copied = await restored.json(`/api/long-form/projects/${copy.id}/publication/compile`, {});
    expect(playDemo(copied.bundle, copied.playerConfig).final.state).toEqual(playDemo(restoredBundle, variants[0]!.config).final.state);
    const copiedZip = Buffer.from(await (await restored.response(`/api/long-form/projects/${copy.id}/publication/exports/static`)).arrayBuffer()); await writeFile(join(output, "duplicate.zip"), copiedZip);
    const copiedFiles = unzipSync(copiedZip);
    variants.push({ mode: "restored", surface: "static", files: restoredFiles, bundle: restoredBundle, config: JSON.parse(Buffer.from(restoredFiles["player-config.json"]!).toString()) }, { mode: "duplicate", surface: "static", files: copiedFiles, bundle: copied.bundle, config: copied.playerConfig });
    manifest.duplicate = { projectId: copy.id, bundleFingerprint: copied.bundle.bundleFingerprint, finalStateEqualsOriginal: true }; manifest.artifacts.push(...restoredArtifact.artifacts, { file: "duplicate.zip", sha256: sha(copiedZip), bytes: copiedZip.length });
    manifest.operationNames = [...host.calls, ...restored.calls];
    await host.close(); await restored.close(); manifest.creatorStoppedBeforePlay = true;
    const server = createServer((req, res) => {
      const parts = (req.url ?? "").split("/"), variant = variants.find((v) => v.mode === parts[1] && v.surface === "static"), path = parts.slice(2).join("/"), bytes = variant?.files[path];
      if (!bytes) { res.writeHead(404); res.end(); return; } res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "text/html"); res.end(Buffer.from(bytes));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const addr = server.address(); const origin = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    try {
      for (const variant of variants) for (const [width, height] of variant.mode === "restored" || variant.mode === "duplicate" ? [[390, 844]] : [[1280, 900], [390, 844]]) {
        const context = await browser.newContext({ viewport: { width, height } }), player = await context.newPage(), requests: string[] = [], pageErrors: string[] = [];
        player.setDefaultTimeout(15000); player.on("request", (r) => requests.push(r.url())); player.on("pageerror", (e) => pageErrors.push(e.message));
        try {
          await player.goto(variant.surface === "standalone" ? pathToFileURL(variant.html!).href : `${origin}/${variant.mode}/index.html`);
          const expected = playDemo(variant.bundle, variant.config), views = player.getByRole("region", { name: "World views", exact: true }), nav = player.getByRole("navigation", { name: "World views", exact: true });
          const show = async (name: string) => { await nav.getByRole("button", { name, exact: true }).click(); };
          const confirm = async (button: Locator) => { await button.click(); await player.getByRole("button", { name: "Confirm action", exact: true }).click(); await expect(player.getByRole("button", { name: "Confirm action", exact: true })).toHaveCount(0); };
          const imageReady = async () => {
            await player.evaluate(() => document.fonts.ready); for (const img of await player.locator(".illustrated-scene img").all()) await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
            const geometry = await player.locator(".scene-stage").evaluate((el) => { const r = el.getBoundingClientRect(); return [...el.querySelectorAll(".scene-portrait,img,figcaption")].filter((node) => node.closest(".scene-portrait")).every((node) => { const b = node.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1; }); }); expect(geometry).toBe(true);
            expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          };
          await expect(views.getByLabel("Game time")).toHaveText("Day 1 · 07:00"); await imageReady();
          await nav.getByRole("button", { name: "Explore", exact: true }).focus(); await player.keyboard.press("Tab"); await expect(nav.getByRole("button", { name: "Character", exact: true })).toBeFocused(); await player.keyboard.press("Space"); await expect(views.getByRole("heading", { name: "Character", level: 3 })).toBeFocused();
          await expect(player.locator(".illustrated-scene")).toHaveCount(0); await expect(views.getByText("Trust with Mara", { exact: true })).toBeVisible(); await player.keyboard.press("Escape"); await expect(nav.getByRole("button", { name: "Explore", exact: true })).toBeFocused();
          await show("Journal"); await views.getByRole("button", { name: "Entries", exact: true }).click(); await expect(views.getByRole("heading", { name: "A note for the morning", exact: true })).toBeVisible(); await expect(views.getByRole("heading", { name: "The cracked shutter", exact: true })).toHaveCount(0); await player.keyboard.press("Escape");
          await views.getByRole("button", { name: "Listen to the tide (optional) · 3 min", exact: true }).click(); await player.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(views.getByLabel("Game time")).toHaveText("Day 1 · 07:00"); expect(await readSave(player)).toBeUndefined();
          await confirm(views.getByRole("button", { name: "Listen to the tide (optional) · 3 min", exact: true }));
          await views.getByText("Map", { exact: true }).click(); await views.getByRole("button", { name: "Inspect Quay cafe", exact: true }).click(); await expect(views.getByRole("region", { name: "Destination", exact: true })).toContainText("Quay cafe"); await imageReady();
          await player.screenshot({ path: info.outputPath(`w6-${variant.mode}-${variant.surface}-${width}-explore.png`), fullPage: true });
          await confirm(views.getByRole("navigation", { name: "Travel", exact: true }).getByRole("button", { name: "Quay cafe · 7 min", exact: true }));
          await expect(views.getByRole("region", { name: "People present", exact: true })).toContainText("No one encountered"); await show("Give a gift"); await expect(views.getByText("No authored gifts for anyone here.", { exact: true })).toBeVisible();
          await show("Shops here"); expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          if (variant.mode === "chapter-led" && variant.surface === "standalone" && width === 1280) await player.screenshot({ path: info.outputPath("w6-chapter-led-standalone-1280-shop.png"), fullPage: true });
          await confirm(views.getByRole("button", { name: "Buy 1 Tea · 3 Coins · 2 min", exact: true })); await expect(views.getByText("Out of stock", { exact: true })).toBeVisible();
          await show("Explore"); await confirm(views.getByRole("button", { name: "Wait 5 min", exact: true })); await expect(views.getByRole("region", { name: "People present", exact: true })).toContainText("Mara");
          await show("Give a gift"); expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          if (variant.mode === "chapter-free" && variant.surface === "static" && width === 390) await player.screenshot({ path: info.outputPath("w6-chapter-free-static-390-gift.png"), fullPage: true });
          await confirm(views.getByRole("button", { name: /^Share a warm cup · 1 Tea to Mara · 1 min/ })); await show("Explore"); await expect(views).toContainText("Required encounter: Hear Mara's warning"); await expect(views.getByRole("button", { name: "Wait 5 min", exact: true })).toBeDisabled();
          await imageReady(); await player.screenshot({ path: info.outputPath(`w6-${variant.mode}-${variant.surface}-${width}-encounter.png`), fullPage: true });
          await confirm(views.getByRole("button", { name: "Hear Mara's warning · 5 min", exact: true })); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.afterWarning.state);
          await player.getByRole("button", { name: "Save game", exact: true }).click(); await player.getByLabel("Save name", { exact: true }).fill("Mara's warning"); await player.getByRole("button", { name: "Create save", exact: true }).click();
          await expect(player.getByRole("status").filter({ hasText: /^Saved “Mara's warning”\.$/ })).toBeVisible();
          await player.reload(); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.afterWarning.state);
          const finish = async () => { await show("Explore"); await confirm(views.getByRole("button", { name: variant.bundle.world.progression.chapters.length ? "Begin II · An honest light · 2 min" : "Take the warning to the station · 2 min", exact: true })); await confirm(views.getByRole("button", { name: "Prepare the honest signal · 3 min", exact: true })); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.prepared.state); };
          await finish(); await expect(views.getByRole("region", { name: "People present", exact: true })).toContainText("Mara"); await show("Character"); await expect(views.getByRole("definition")).toHaveText("3");
          await show("Journal"); await views.getByRole("button", { name: "Objectives", exact: true }).click(); await expect(views.getByRole("region", { name: "Objectives", exact: true })).toContainText("No active objectives disclosed."); await expect(views.getByRole("region", { name: "Objectives", exact: true })).toContainText("Completed objectives");
          await player.screenshot({ path: info.outputPath(`w6-${variant.mode}-${variant.surface}-${width}-journal.png`), fullPage: true });
          await show("Explore"); await imageReady(); await player.getByRole("button", { name: "Light the honest signal", exact: true }).click(); await expect(player.getByRole("heading", { name: "The Honest Signal", exact: true })).toBeVisible(); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.final.state); await imageReady();
          await player.screenshot({ path: info.outputPath(`w6-${variant.mode}-${variant.surface}-${width}-ending.png`), fullPage: true });
          await player.reload(); await expect(player.getByRole("heading", { name: "The Honest Signal", exact: true })).toBeVisible();
          await player.getByRole("button", { name: "Rewind", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.prepared.state); await player.getByRole("button", { name: "Light the honest signal", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.final.state);
          await player.getByRole("button", { name: "Load game", exact: true }).click(); await player.getByRole("button", { name: "Load", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.afterWarning.state); await finish(); await player.getByRole("button", { name: "Light the honest signal", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.final.state);
          const state = (await readSave(player)).state; expect(state.world.economy.currency).toBe(3); expect(state.relationships[demo.trust]).toBe(3); expect(state.world.journal.completedObjectiveIds).toEqual(["cup", "signal", "warning"]); expect(state.world.journal.entryIds).toEqual(["guide", "memory", "ready", "warning"]); expect(state.world.minutes).toBe(448);
          const stateFile = `w6-${variant.mode}-${variant.surface}-${width}-state.json`; await writeFile(info.outputPath(stateFile), JSON.stringify(state, null, 2) + "\n");
          if (width === 390 && (variant.mode === "chapter-led" && variant.surface === "static" || variant.mode === "chapter-free" && variant.surface === "standalone")) {
            await player.getByRole("button", { name: "Rewind", exact: true }).click(); await expect.poll(async () => (await readSave(player))?.state).toEqual(expected.prepared.state);
            await player.getByRole("button", { name: "Share the watch", exact: true }).click(); await expect(views.getByRole("region", { name: "People present", exact: true })).toContainText("Mara");
            const sharedExit = variant.bundle.choices.find((c: any) => c.id === "choice-passage-route-2-act-ending-2").text;
            await player.getByRole("button", { name: sharedExit, exact: true }).click(); await expect(player.getByRole("heading", { name: "A Shared Repair", exact: true })).toBeVisible();
            const sharedState = (await readSave(player)).state; expect(sharedState.world.locationId).toBe("station"); expect(sharedState.currentPassageId).toBe("passage-ending-2"); await imageReady();
            await player.screenshot({ path: info.outputPath(`w6-${variant.mode}-${variant.surface}-${width}-shared-ending.png`), fullPage: true });
            await player.getByRole("button", { name: "Restart", exact: true }).click(); await player.getByRole("button", { name: "Restart game", exact: true }).click();
            await player.getByRole("button", { name: "Hand over the watch (early ending)", exact: true }).click(); await player.getByRole("button", { name: "Finish the handover", exact: true }).click();
            await expect(player.getByRole("heading", { name: "The Unfinished Watch", exact: true })).toBeVisible(); const earlyState = (await readSave(player)).state; expect(earlyState.currentPassageId).toBe("passage-ending-3"); expect(earlyState.world.journal.completedObjectiveIds).toEqual([]);
            manifest.alternateEndings ??= []; manifest.alternateEndings.push({ mode: variant.mode, surface: variant.surface, width, sharedEndingId: "ending-2", sharedLocation: "station", earlyEndingId: "ending-3", earlyObjectives: [] });
          }
          expect(pageErrors).toEqual([]); expect(requests.filter((u) => /\/api\/|openrouter|provider/i.test(u) || /^https?:/.test(u) && !u.startsWith(origin))).toEqual([]);
          manifest.plays.push({ mode: variant.mode, surface: variant.surface, width, stateFile, finalStateSha256: sha(Buffer.from(JSON.stringify(state))), requests, pageErrors });
        } finally { await context.close(); }
      }
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  } finally { await host.close(); await restored?.close(); await rm(directory, { recursive: true, force: true }); }
});
