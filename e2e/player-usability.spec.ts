import { expect, test } from "playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { demoHost } from "../demos/last-harbor-signal/host.js";
import { applyGameEdit, completeConnectedTextGame, proposeGameEdit } from "./helpers/connected-text-game.js";
import { applyPreviewWorld } from "./helpers/partial-preview.js";
import { authoredWorld } from "./helpers/world.js";
import { withAuthoredPeople } from "./helpers/people.js";
import { showPlayerWorldView } from "./helpers/player-interaction.js";

test("PF-016–019 play a neutral clinic repair and interview offline on desktop and mobile", async ({ browser }, info) => {
  test.setTimeout(120000);
  const directory = await mkdtemp(join(tmpdir(), "cyoa-player-usability-")), projectId = randomUUID();
  const host = await demoHost(directory, projectId);
  let stopped = false;
  try {
    const call = host.call, pivot = "passage-shared-route-pivot", openingId = "passage-shared-opening";
    const responses = [
      ["Ask who witnessed the repair", "Marek signs the repair record."],
      ["Ask about the spare seal", "Marek points to the sealed parts locker."],
      ["Ask when the pump was inspected", "Marek shows the inspection timestamp."],
    ] as const;
    await call("create_project", { projectId, operationId: randomUUID(), approved: true, name: "Disposable clinic and interview" });
    const { exported } = await completeConnectedTextGame(call, projectId, undefined, undefined, async () => {
      const passage = (await call("read_game_record", { projectId, kind: "passage", entityId: pivot })).record;
      const opening = (await call("read_game_record", { projectId, kind: "passage", entityId: openingId })).record;
      const seed = (await call("read_game_record", { projectId, kind: "choice", entityId: passage.content.choiceIds[0] })).record.content;
      const root = (await call("read_game_record", { projectId, kind: "structure" })).record;
      const sequenceKey = `collection:sequence:${opening.content.sequenceId}:passageIds`;
      const edited = await proposeGameEdit(call, projectId, "Add the clinic hub and neutral interview responses", [
        { key: "create:passage-plan:passage", versionId: root.id }, { key: sequenceKey, versionId: root.id },
        { key: "create:passage-plan:choice", versionId: root.id }, { key: `passage:${pivot}`, versionId: passage.id },
      ], [
        { targetKey: "create:passage-plan:passage", kind: "add-entity", entityKind: "passage", item: {
          ...opening.content, id: "$new:hub", title: "Clinic desk", kind: "hub", interactionMode: "world-location",
          summary: "The clinic's ordinary location hub.", purpose: "Choose local activities or travel.", choiceIds: [], setupThreadIds: [], position: 4,
        } },
        { targetKey: sequenceKey, kind: "append-passage", passageId: "$new:hub" },
        ...responses.map(([label, feedback], i) => ({ targetKey: "create:passage-plan:choice", kind: "add-entity", entityKind: "choice", item: {
          ...seed, id: `$new:response-${i}`, sourcePassageId: pivot, destinationPassageId: pivot, position: i + 2, label,
          effects: [{ id: `$new:result-${i}`, mechanicKey: "integrity", operation: "add", value: 1, feedback, visibility: "visible" },
            ...(i === 0 ? [{ id: "$new:private", mechanicKey: "insight", operation: "add", value: 1, feedback: "Hidden fixture feedback.", visibility: "hidden" }] : [])],
        } })),
        { targetKey: "create:passage-plan:choice", kind: "add-entity", entityKind: "choice", item: {
          ...seed, id: "$new:quiet", sourcePassageId: pivot, destinationPassageId: pivot, position: 5, label: "Listen quietly", effects: [],
        } },
        { targetKey: `passage:${pivot}`, kind: "set-fields", changes: { interactionMode: "decisions", choiceIds: [...passage.content.choiceIds, ...responses.map((_, i) => `$new:response-${i}`), "$new:quiet"] } },
      ]);
      const saved = await call("get_edit", { projectId, proposalId: edited.proposalId });
      const hubId = saved.proposal.generatedIds["$new:hub"];
      await applyGameEdit(call, projectId, edited.proposalId);
      const review = await call("review_game_plan", { projectId });
      expect(review.report.findings.filter((finding: { code: string }) => finding.code === "choice.self-loop.no-visible-feedback"))
        .toEqual([expect.objectContaining({ severity: "warning" })]);
      const world = await withAuthoredPeople(call, projectId, await authoredWorld(call, projectId));
      world.initialMinutes = 1400;
      world.introduction = world.locations.find(l => l.id === "home")!.passage!;
      world.locations.find(l => l.id === "home")!.passage = { passageId: hubId, versionId: (await call("read_game_record", { projectId, kind: "passage", entityId: hubId })).record.id };
      const required = world.progression!.events.find(e => e.id === "urgent")!;
      const here = { kind: "location", locationId: "home", present: true } as const;
      world.progression = { ...world.progression!, chapters: [], initialChapterId: null, transitions: [], events: [
        { ...required, prerequisites: [here, { kind: "time", from: 1440, until: null }] },
        { ...required, id: "repair", label: "Replace the clinic seal", minutes: 35, prerequisites: [here], visibility: "always", milestoneIds: [], result: "The clinic pump runs smoothly." },
        { ...required, id: "interview", label: "Attend the interview", minutes: 0, prerequisites: [here], visibility: "always", milestoneIds: [],
          passage: { passageId: pivot, versionId: (await call("read_game_record", { projectId, kind: "passage", entityId: pivot })).record.id }, result: "The clerk opens the record." },
      ] };
      world.people!.events = [...world.people!.events.filter(item => item.eventId === "urgent"),
        ...["repair", "interview"].map(eventId => ({ eventId, priority: 0, mandatory: false, characterIds: [] }))];
      world.people!.overrides = [];
      world.economy = { schemaId: "cyoa.world-economy", schemaVersion: 1, currency: { name: "Coins", initial: 5, maximum: 20 },
        items: [{ id: "seal", name: "Seal", description: "A clinic pump seal.", initial: 1, maximum: 1, consumable: true }],
        shops: [], gifts: [], uses: [], eventEffects: [{ eventId: "repair", costs: { currency: 1, items: [{ itemId: "seal", quantity: 1 }] },
          effects: { currency: 0, items: [], relationships: [], milestoneIds: [] } }] };
      world.journal = { schemaId: "cyoa.world-journal", schemaVersion: 1, character: [], entries: [], objectives: [], locations: [{ locationId: "cafe", when: [] }] };
      await expect(call("review_world", { projectId, world: { ...world, introduction: undefined } })).rejects.toThrow("world_start_passage_must_match_game");
      await applyPreviewWorld(call, projectId, world);
      return [{ passageId: hubId, proseMarkdown: "The clinic desk holds a repair ledger and a tin of spare seals." }];
    });
    const file = join(directory, "neutral.html");
    await writeFile(file, await (await host.response(exported.downloadPath)).text());
    await host.close(); stopped = true;
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ offline: true, viewport: { width, height: 844 } });
      try {
        const page = await context.newPage(), requests: string[] = [];
        page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
        await page.goto(pathToFileURL(file).href);
        const time = page.getByLabel("Game time"), result = page.getByRole("region", { name: "Action outcome" });
        const next = page.getByRole("button", { name: "Continue after result" });
        const confirm = page.getByRole("button", { name: "Confirm action", exact: true });
        const command = (name: RegExp) => page.getByRole("button", { name });
        await expect(time).toHaveText("Day 1 · 23:20");
        await expect(page.getByRole("heading", { name: "A Signal in the Rain" })).toBeVisible();
        await showPlayerWorldView(page, "Map");
        const map = page.getByRole("region", { name: "World map", exact: true });
        await expect(map.locator(".world-map-schematic svg polyline")).toHaveCount(2);
        await expect(map).not.toContainText("Station");
        await expect(map.getByRole("button", { name: "Travel to Cafe (15 min)" })).toHaveCount(0);
        await map.getByRole("button", { name: "Inspect Cafe" }).click();
        await expect(map.getByRole("region", { name: "Destination" })).toContainText("Cafe");
        await map.getByRole("button", { name: "Travel to Cafe (15 min)" }).click();
        await expect(page.getByRole("heading", { name: "Travel to Cafe (15 min)?" })).toBeVisible();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(time).toHaveText("Day 1 · 23:20");
        await page.screenshot({ path: info.outputPath(`schematic-${width}.png`) });
        await map.getByLabel("Area").selectOption("cafe");
        await expect(map.locator(".world-map-schematic svg")).toHaveCount(0);
        await map.getByText("Directed connections", { exact: true }).click();
        await expect(map.getByText("Home to Cafe: 15 min", { exact: true })).toBeVisible();
        await expect(map).not.toContainText("Station");
        await map.getByRole("button", { name: /^Cafe · 15 min$/ }).click();
        await map.getByRole("button", { name: "Travel to Cafe (15 min)" }).click(); await confirm.click();
        await expect(page.getByRole("heading", { name: "The Open Ledger" })).toBeFocused();
        await expect(time).toHaveText("Day 1 · 23:35");
        await showPlayerWorldView(page, "Explore");
        await command(/^Home · 15 min$/).click(); await confirm.click();
        await expect(page.getByRole("heading", { name: "Clinic desk" })).toBeFocused();
        await expect(page.getByText(/The clinic desk holds a repair ledger/)).toBeVisible();
        await expect(page.getByText(/Rain rattles the signal glass/)).toHaveCount(0);
        await expect(time).toHaveText("Day 1 · 23:50");
        await command(/^Replace the clinic seal/).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toContainText("A required encounter would interrupt this action.");
        await expect(dialog).not.toContainText("midnight warning");
        await expect(confirm).toHaveCount(0);
        await expect(time).toHaveText("Day 1 · 23:50");
        await command(/^Wait 10 min for the encounter$/).click();
        await expect(time).toHaveText("Day 2 · 00:00"); await next.click();
        await command(/^Hear the midnight warning/).click(); await confirm.click(); await next.click();
        await page.evaluate(() => {
          const put = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (...args) {
            if (this.name === "autosaves") {
              IDBObjectStore.prototype.put = put;
              throw new DOMException("Test autosave failure", "QuotaExceededError");
            }
            return put.apply(this, args);
          };
        });
        await command(/^Replace the clinic seal/).click(); await confirm.click();
        await expect(result).toHaveText("The clinic pump runs smoothly.");
        await expect(page.getByRole("heading", { name: "Action result" })).toBeFocused();
        await expect(page.getByRole("heading", { name: "Clinic desk" })).toHaveCount(0);
        await expect(page.getByText(/The clinic desk holds a repair ledger/)).toHaveCount(0);
        await expect(page.getByRole("alert")).toContainText("not saved");
        await page.getByRole("button", { name: "Retry autosave", exact: true }).click();
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expect(result).toHaveText("The clinic pump runs smoothly.");
        await expect(time).toHaveText("Day 2 · 00:35"); await next.click();
        await expect(page.getByRole("heading", { name: "Clinic desk" })).toBeFocused();
        await expect(time).toHaveText("Day 2 · 00:35");
        await showPlayerWorldView(page, "Inventory");
        await expect(page.getByRole("region", { name: "Inventory and shops" })).toContainText("Coins: 4");
        await expect(page.getByText("No items held.")).toBeVisible();
        await showPlayerWorldView(page, "Explore");
        await command(/^Attend the interview/).click(); await confirm.click();
        await expect(page.getByRole("heading", { name: "The Open Ledger" })).toBeFocused();
        await expect(page.getByRole("navigation", { name: "Local actions" })).toHaveCount(0);
        await expect(page.getByRole("status").filter({ hasText: "Progress autosaved." })).toBeVisible();
        await page.reload();
        await expect(page.getByRole("region", { name: "Choices" })).toBeVisible();
        for (const [label, feedback] of responses) {
          await page.getByRole("button", { name: label, exact: true }).click();
          await expect(result).toHaveText(feedback);
          await expect(page.getByText("Hidden fixture feedback.")).toHaveCount(0);
          await next.click();
        }
        await expect(time).toHaveText("Day 2 · 00:35");
        await command(/^Expose the ledger$/).click();
        await expect(result).toHaveText("The public record names its cost.");
        await expect(page.getByRole("heading", { name: "The Public Quay" })).toBeVisible();
        await page.reload(); await expect(page.getByRole("heading", { name: "The Public Quay" })).toBeVisible();
        await expect(time).toHaveText("Day 2 · 00:35");
        await expect(page.getByText("Hidden fixture feedback.")).toHaveCount(0);
        await page.getByRole("button", { name: "Restart", exact: true }).click();
        await page.getByRole("button", { name: "Restart game", exact: true }).click();
        await expect(page.getByRole("heading", { name: "A Signal in the Rain" })).toBeFocused();
        await expect(time).toHaveText("Day 1 · 23:20");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(requests).toEqual([]);
      } finally { await context.close(); }
    }
  } finally { if (!stopped) await host.close(); await rm(directory, { recursive: true, force: true }); }
});
