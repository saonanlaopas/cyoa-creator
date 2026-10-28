import { randomUUID, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FoundationCall } from "../../e2e/helpers/original-foundations.js";
import { completeEconomyTextGame } from "../../e2e/helpers/economy.js";
import { proposeGameEdit, applyGameEdit, approveGamePlan, submitGameDraft, acceptGameDrafts } from "../../e2e/helpers/connected-text-game.js";
import { fixtureImage, imageMetadata } from "../../e2e/helpers/image-assets.js";
import { portraitImage } from "./assets.js";
import { townMap } from "../../e2e/helpers/world.js";
import { demoWorld } from "./world.js";

export const finalChoice = "choice-passage-route-1-act-ending-1";
export async function authorDemo(call: FoundationCall, projectId: string, staging: string) {
  const proof = await completeEconomyTextGame(call, projectId);
  const options = await call("read_world", { projectId });
  const trust = options.relationshipOptions.find((r: { label: string }) => r.label === "Trust with Mara").key as string;
  const scenes: Record<string, [string, string]> = {
    "passage-shared-opening": ["A Cup Before the Storm", "At seven, the harbor is all gulls and pale light. You are Mira, keeper of a signal that has begun to lie. Your neighbor Mara knows the shutter better than anyone. She often visits the quay cafe after quarter past seven.\n\nStart in Explore. Listening to the tide here is optional. Visit the Quay cafe, buy one Tea in Shops here, wait for Mara if needed, then Give a gift. Your Journal keeps a short guide and your objectives. Reading, maps and menus are free; confirmed activities spend the minutes shown. The story choices below become available after you prepare the signal together."],
    "passage-shared-route-pivot": ["The Quay Cafe", "Steam clouds the cafe window. The counter has one warm parcel of tea set aside for Mara. Buy it in Shops here, then look in Explore to see whether she has arrived. If she is absent, wait; she returns every morning. Share the Tea in Give a gift.\n\nA small kindness can make a difficult conversation possible. Return to Explore after the gift: hear Mara's warning, then carry it to the signal station. Your Journal records what you learn. The other story choices wait until preparations are complete."],
    "passage-route-1-act": ["An Honest Light", "At the signal station, rain begins to prick the glass. Beyond the breakwater, the fishing boats are gathering. Mara's warning is clear: a cracked shutter makes a false flash. Prepare the honest signal in Explore; she will hold the shutter while you align the lens.\n\nWhen the preparation is complete, choose Light the honest signal below for the main ending. Choose Share the watch for the shared-repair alternative, or inspect the damaged lamp before deciding. Those are alternate authored resolutions, all reached after the same shared preparation."],
    "passage-route-2-act": ["The Shared Watch", "The crew gather beside the station. You spread the maintenance ledger on a dry crate: nobody will be asked to trust a promise they cannot inspect. The repair is now a shared responsibility. Read the agreement aloud, then send the light together."],
    "passage-ending-1": ["The Honest Signal", "You hold the light steady while Mara braces the shutter. One boat answers, then another. All turn toward the safe channel. The tower still needs work, but nobody has been asked to follow a lie.\n\nYou leave the ledger open for the next watch. A cup of tea did not mend the mechanism; it made room for the person who knew how. Together, you bought the harbor another morning.\n\nTHE END · The Honest Signal"],
    "passage-ending-2": ["A Shared Repair", "The crew read every name and every promised hour before lifting the brace. You and Mara keep the lamp steady while the first repair holds. The boats find the safe channel. Nothing has been erased from the ledger; a new watch has simply agreed to answer for it.\n\nTHE END · A Shared Repair"],
    "passage-ending-3": ["The Unfinished Watch", "You decide not to send the signal yourself. You leave the maintenance ledger open for the incoming watch and make no promise you cannot keep. Someone else will have to decide what the harbor should be told.\n\nYou have chosen a handover rather than the shared warning. The other endings remain possible on a new playthrough: follow the Journal guide, share Tea with Mara and prepare the signal together.\n\nTHE END · The Unfinished Watch"],
    [proof.generated["$new:beacon"]]: ["The Last Lamp", "You inspect the shutter with Mara beside you. The shared preparation made a warning possible, but the inner brace is failing. You may hand over the watch instead of sending a light you no longer trust. This is an alternate ending, not an additional errand."],
  };
  const originalPassages = await Promise.all(proof.passages.map((p: { entityId: string }) => call("read_game_record", { projectId, kind: "passage", entityId: p.entityId }).then((r) => r.record)));
  const nonterminal = originalPassages.filter((p) => !p.content.terminal);
  const structure = (await call("read_game_record", { projectId, kind: "structure" })).record;
  const seed = (await call("read_game_record", { projectId, kind: "choice", entityId: "choice-passage-shared-opening-continue" })).record.content;
  const station = nonterminal.find((p) => p.entityId === "passage-route-1-act")!;
  const bridge = await proposeGameEdit(call, projectId, "Author the route-bound early handover passage", [{ key: "passage-structure:root", versionId: structure.id }, { key: `passage:${station.entityId}`, versionId: station.id }], [
    { targetKey: "passage-structure:root", kind: "add-entity", entityKind: "passage", item: { ...originalPassages[0].content, id: "$new:handover", sequenceId: "sequence-route-1-act", title: "The Handover", routeIds: ["route-1"], terminal: false, endingId: null, setupThreadIds: [], payoffThreadIds: [], choiceIds: ["$new:handover-end"], position: 9 } },
    { targetKey: "passage-structure:root", kind: "add-entity", entityKind: "choice", item: { ...seed, id: "$new:handover-end", sourcePassageId: "$new:handover", destinationPassageId: "passage-ending-3", label: "Finish the handover", narrativeIntent: "End the watch without claiming the shared warning.", condition: null, effects: [], position: 0 } },
    { targetKey: "passage-structure:root", kind: "add-entity", entityKind: "choice", item: { ...seed, id: "$new:shared-watch", sourcePassageId: station.entityId, destinationPassageId: "passage-route-2-act", label: "Share the watch", narrativeIntent: "Choose a public shared repair at the signal station.", condition: { kind: "compare", mechanicKey: trust, operator: "gte", value: 3 }, unavailableBehavior: "disabled", unavailableExplanation: "Prepare the honest signal with Mara first.", effects: [], position: station.content.choiceIds.length } },
    { targetKey: `passage:${station.entityId}`, kind: "set-fields", changes: { choiceIds: [...station.content.choiceIds, "$new:shared-watch"] } },
    { targetKey: "passage-structure:root", kind: "set-fields", changes: { sequences: structure.content.sequences.map((q: any) => q.id === "sequence-route-1-act" ? { ...q, passageIds: [...q.passageIds, "$new:handover"] } : q) } },
  ]);
  const bridgeIds = (await call("get_edit", { projectId, proposalId: bridge.proposalId })).proposal.generatedIds;
  await applyGameEdit(call, projectId, bridge.proposalId);
  const refreshedNonterminal = await Promise.all(nonterminal.map((p) => call("read_game_record", { projectId, kind: "passage", entityId: p.entityId }).then((r) => r.record)));
  const updatedStructure = (await call("read_game_record", { projectId, kind: "structure" })).record;
  const escapes = await proposeGameEdit(call, projectId, "Author an explicit early handover from every nonterminal scene", [{ key: "passage-structure:root", versionId: updatedStructure.id }, ...refreshedNonterminal.map((p) => ({ key: `passage:${p.entityId}`, versionId: p.id }))], refreshedNonterminal.flatMap((p, i) => [
    { targetKey: "passage-structure:root", kind: "add-entity", entityKind: "choice", item: { ...seed, id: `$new:handover-${i}`, sourcePassageId: p.entityId, destinationPassageId: bridgeIds["$new:handover"], label: "Hand over the watch (early ending)", narrativeIntent: "Decline the shared warning and explicitly hand over responsibility.", consequencePreview: "Ends this playthrough without sending the signal. Restart to follow the full Journal guide.", condition: { kind: "compare", mechanicKey: trust, operator: "lt", value: 3 }, unavailableBehavior: "hidden", effects: [], position: p.content.choiceIds.length } },
    { targetKey: `passage:${p.entityId}`, kind: "set-fields", changes: { choiceIds: [...p.content.choiceIds, `$new:handover-${i}`] } },
  ]));
  const generated = { ...bridgeIds, ...(await call("get_edit", { projectId, proposalId: escapes.proposalId })).proposal.generatedIds };
  const earlyIds = new Set(Object.values(generated));
  await applyGameEdit(call, projectId, escapes.proposalId);
  scenes[generated["$new:handover"]] = ["The Handover", "You write down what you know and leave the ledger for the incoming watch. This will end your playthrough without the shared signal. Finish the handover below, or use Restart if you want to follow the Journal guide instead."];
  const passages = await Promise.all([...proof.passages, { entityId: generated["$new:handover"] }].map((p: { entityId: string }) => call("read_game_record", { projectId, kind: "passage", entityId: p.entityId }).then((r) => r.record)));
  const choiceIds = [...new Set<string>(passages.flatMap((p) => p.content.choiceIds))];
  const choices = await Promise.all(choiceIds.map((entityId) => call("read_game_record", { projectId, kind: "choice", entityId }).then((r) => r.record)));
  const operations = [
    ...passages.map((p) => ({ targetKey: `passage:${p.entityId}`, kind: "set-fields", changes: { title: scenes[p.entityId]![0], summary: scenes[p.entityId]![1].split("\n")[0], purpose: "Carry shared preparation into an authored resolution.", draftingNotes: ["Exact offline demonstration prose; no generation during play."] } })),
    ...choices.filter((c) => !earlyIds.has(c.entityId)).map((c) => ({ targetKey: `choice:${c.entityId}`, kind: "set-fields", changes: { condition: { kind: "compare", mechanicKey: trust, operator: "gte", value: 3 }, unavailableBehavior: "disabled", unavailableExplanation: "Use Explore: share Tea, hear Mara's warning, carry it to the station, then prepare the signal.", ...(c.entityId === proof.generated["$new:compact"] ? { destinationPassageId: "passage-route-1-act", label: "Bring the crew to the station", narrativeIntent: "Return to the actual station before choosing the shared watch." } : c.entityId === finalChoice ? { label: "Light the honest signal", narrativeIntent: "Send a steady truthful light with Mara's help." } : c.content.destinationPassageId === "passage-ending-3" ? { label: "Hand over the damaged lamp", narrativeIntent: "Let the incoming watch decide how to use the damaged light." } : {}) } })),
  ];
  // Respect the existing bounded 12-target review contract.
  for (const records of [passages, choices.slice(0, 10), choices.slice(10)]) {
    const targets = records.map((r) => ({ key: `${r.content.sourcePassageId ? "choice" : "passage"}:${r.entityId}`, versionId: r.id }));
    const batch = operations.filter((o) => targets.some((t) => t.key === o.targetKey));
    if (!batch.length) continue;
    const proposal = await proposeGameEdit(call, projectId, "Author the complete visual demonstration and its preparation gates", targets, batch);
    await applyGameEdit(call, projectId, proposal.proposalId);
  }
  await approveGamePlan(call, projectId);
  const drafts = [];
  for (const p of passages) { const d = await submitGameDraft(call, projectId, p.entityId, scenes[p.entityId]![1]); drafts.push({ passageId: p.entityId, candidateDraftVersionId: d.draftVersionId }); }
  await acceptGameDrafts(call, projectId, drafts);
  const assetEvidence: Array<{ filename: string; sha256: string; approvedSha256: string; source: string }> = [];
  const image = async (filename: string, bytes: Buffer, title: string, altText: string, source: string) => {
    await writeFile(join(staging, filename), bytes); const sha256 = createHash("sha256").update(bytes).digest("hex");
    const candidate = await call("import_staged_asset", { projectId, operationId: randomUUID(), approved: true, filename, sourceSha256: sha256, metadata: { ...imageMetadata, title, description: altText, altText, credit: "Original deterministic repository bitmap fixtures; no provider call", license: "CC0" } });
    const review = await call("review_asset", { projectId, assetId: candidate.assetId, versionId: candidate.versionId });
    const approved = await call("approve_asset", { projectId, operationId: randomUUID(), approved: true, assetId: candidate.assetId, versionId: candidate.versionId, fingerprint: review.fingerprint });
    const detail = await call("read_asset", { projectId, assetId: approved.assetId });
    assetEvidence.push({ filename, sha256, approvedSha256: detail.approved.image.sha256, source }); return { assetId: approved.assetId, versionId: approved.versionId };
  };
  const map = await image("harbor-map.png", townMap(), "Harbor district", "Map of the keeper's house, quay cafe and signal station", "e2e/helpers/world.ts:townMap");
  const background = await image("harbor.png", fixtureImage(), "Harbor morning", "Red signal tower over blue harbor water", "e2e/helpers/image-assets.ts:fixtureImage");
  const cafe = await image("cafe.png", fixtureImage(512, 320, true), "Warm quay light", "Signal tower in warm yellow morning light", "e2e/helpers/image-assets.ts:fixtureImage alternate");
  const mira = await image("mira.png", portraitImage(), "Mira before the warning", "Mira in a green coat with a concerned expression", "e2e/helpers/illustrated-assets.ts:portraitImage");
  const relieved = await image("mira-relieved.png", portraitImage(true), "Mira after the warning", "Mira in a red coat with a relieved expression", "e2e/helpers/illustrated-assets.ts:portraitImage smiling");
  for (const p of passages) {
    const { scene } = await call("read_scene", { projectId, passageId: p.entityId }), ending = p.content.terminal;
    const authored = { ...scene, layout: "illustrated", background: p.entityId === "passage-shared-route-pivot" ? cafe : background,
      portraits: [{ character: "Mira", expression: ending ? "Relieved" : "Concerned", position: "left", image: ending ? relieved : mira }], dialogue: [{ speaker: "Mira", text: ending ? "An honest light, and someone to share the watch." : "A truthful signal begins with listening." }] };
    const review = await call("review_scene", { projectId, scene: authored }); await call("apply_scene", { projectId, scene: authored, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true });
  }
  const refs: Record<string, { passageId: string; versionId: string }> = {};
  for (const [key, passageId] of Object.entries({ home: "passage-shared-opening", cafe: "passage-shared-route-pivot", station: "passage-route-1-act" })) refs[key] = { passageId, versionId: (await call("read_game_record", { projectId, kind: "passage", entityId: passageId })).record.id };
  return { trust, sharedWatchChoiceId: generated["$new:shared-watch"] as string, assetEvidence, world: demoWorld(refs, map, trust, true), freeWorld: demoWorld(refs, map, trust, false), proof };
}
