import { randomUUID } from "node:crypto";
import { completeOriginalFoundations, type FoundationCall } from "./original-foundations.js";

export async function proposeGameEdit(call: FoundationCall, projectId: string, message: string, targets: Array<{ key: string; versionId: string }>, operations: unknown[]) {
  const state = await call("project_state", { projectId });
  const preview = await call("prepare_edit", { projectId, operationId: randomUUID(), message, headFingerprint: state.headFingerprint, targets });
  return call("submit_edit", { projectId, operationId: randomUUID(), planId: preview.plan.id, fingerprint: preview.plan.fingerprint,
    response: { message, groups: [{ id: "game", label: "Original game plan", explanation: "Exact authored graph changes; no generation or prose replacement.", dependsOnGroupIds: [], operations }] } });
}
export async function applyGameEdit(call: FoundationCall, projectId: string, proposalId: string) {
  const review = await call("review_edit", { projectId, proposalId, groupIds: ["game"] });
  return call("apply_edit", { projectId, operationId: randomUUID(), proposalId, groupIds: ["game"], fingerprint: review.fingerprint, approved: true });
}
export async function approveGamePlan(call: FoundationCall, projectId: string) {
  const review = await call("review_game_plan", { projectId });
  return call("approve_game_plan", { projectId, operationId: randomUUID(), headFingerprint: review.headFingerprint, fingerprint: review.fingerprint, approved: true });
}
export async function submitGameDraft(call: FoundationCall, projectId: string, passageId: string, proseMarkdown: string) {
  const { record, headFingerprint } = await call("read_game_record", { projectId, kind: "passage", entityId: passageId });
  return call("submit_draft", { projectId, operationId: randomUUID(), headFingerprint, passageId, passageVersionId: record.id,
    request: "Author this exact harbor scene as a candidate. Preserve choices and existing accepted prose until separately reviewed.", proseMarkdown, approved: true });
}
export async function acceptGameDrafts(call: FoundationCall, projectId: string, selections: Array<{ passageId: string; candidateDraftVersionId: string }>) {
  const review = await call("review_drafts", { projectId, selections });
  return call("accept_drafts", { projectId, operationId: randomUUID(), selections, fingerprint: review.fingerprint, approved: true });
}

export async function completeConnectedTextGame(call: FoundationCall, projectId: string, onCandidate?: (passageId: string, draft: any) => Promise<void>, afterBible?: () => Promise<void>) {
  await completeOriginalFoundations(call, projectId, undefined, afterBible);
  const initial = await call("game_state", { projectId });
  await call("initialize_game_plan", { projectId, operationId: randomUUID(), headFingerprint: initial.headFingerprint, approved: true });
  const structure = (await call("read_game_record", { projectId, kind: "structure" })).record;
  const read = async (kind: string, entityId: string) => (await call("read_game_record", { projectId, kind, entityId })).record;
  const pivot = await read("passage", "passage-shared-route-pivot"), opening = await read("passage", "passage-shared-opening");
  const detour = await read("choice", "choice-passage-route-1-act-continue"), payoff = await read("passage", "passage-ending-3");
  const seedChoice = (await read("choice", "choice-passage-shared-route-pivot-continue")).content;
  const newPassage = { ...opening.content, id: "$new:beacon", sequenceId: "sequence-route-1-act", title: "The last lamp", purpose: "Test Mira's warning against the damaged beacon.",
    summary: "Mira checks the last lamp before choosing to warn the harbor.", wordTarget: 200, routeIds: ["route-1"], setupThreadIds: [], payoffThreadIds: [], choiceIds: ["$new:beacon-exit"], position: 8 };
  const proposal = await proposeGameEdit(call, projectId, "Author the harbor branch, optional beacon investigation and warning thread", [
    { key: "passage-structure:root", versionId: structure.id }, { key: `passage:${pivot.entityId}`, versionId: pivot.id },
    { key: `choice:${detour.entityId}`, versionId: detour.id }, { key: `passage:${opening.entityId}`, versionId: opening.id }, { key: `passage:${payoff.entityId}`, versionId: payoff.id },
  ], [
    { targetKey: "passage-structure:root", kind: "add-entity", entityKind: "passage", item: newPassage },
    { targetKey: "passage-structure:root", kind: "add-entity", entityKind: "choice", item: { ...seedChoice, id: "$new:compact", sourcePassageId: pivot.entityId, destinationPassageId: "passage-route-2-act", label: "Negotiate a shared repair", narrativeIntent: "Choose an open civic compact over a solitary accusation.", sourceDecisionIds: ["decision-route-selection"], position: 1 } },
    { targetKey: "passage-structure:root", kind: "add-entity", entityKind: "choice", item: { ...seedChoice, id: "$new:beacon-exit", sourcePassageId: "$new:beacon", destinationPassageId: payoff.entityId, label: "Send the costly warning", narrativeIntent: "Save lives even if the beacon cannot be saved.", position: 0 } },
    { targetKey: "passage-structure:root", kind: "add-entity", entityKind: "thread", item: { id: "$new:warning", label: "The false signal", description: "An early false signal makes the final honest warning meaningful.", setupPassageIds: [opening.entityId], payoffPassageIds: [payoff.entityId], routeIds: ["route-1"], required: false, status: "planned", waiverRationale: "" } },
    { targetKey: "passage-structure:root", kind: "set-fields", changes: { sequences: structure.content.sequences.map((s: any) => s.id === "sequence-route-1-act" ? { ...s, passageIds: [...s.passageIds, "$new:beacon"] } : s) } },
    { targetKey: `passage:${pivot.entityId}`, kind: "set-fields", changes: { choiceIds: [...pivot.content.choiceIds, "$new:compact"] } },
    { targetKey: `choice:${detour.entityId}`, kind: "set-fields", changes: { destinationPassageId: "$new:beacon", label: "Inspect the last lamp", narrativeIntent: "Look for evidence before sending a final warning." } },
    { targetKey: `passage:${opening.entityId}`, kind: "set-fields", changes: { setupThreadIds: ["$new:warning"] } },
    { targetKey: `passage:${payoff.entityId}`, kind: "set-fields", changes: { payoffThreadIds: ["$new:warning"] } },
  ]);
  const saved = await call("get_edit", { projectId, proposalId: proposal.proposalId }), generated = saved.proposal.generatedIds;
  await applyGameEdit(call, projectId, proposal.proposalId);
  const publicChoice = await read("choice", "choice-passage-shared-route-pivot-continue"), compactChoice = await read("choice", generated["$new:compact"]);
  const consequences = await proposeGameEdit(call, projectId, "Author the public commitment and visible consequences of both harbor branches", [
    { key: `choice:${publicChoice.entityId}`, versionId: publicChoice.id }, { key: `choice:${compactChoice.entityId}`, versionId: compactChoice.id },
  ], [
    { targetKey: `choice:${publicChoice.entityId}`, kind: "set-fields", changes: { label: "Expose the ledger", narrativeIntent: "Commit to public accountability.", sourceDecisionIds: ["decision-route-selection"] } },
    { targetKey: `choice:${publicChoice.entityId}`, kind: "add-item", collection: "effects", item: { id: "$new:integrity", mechanicKey: "integrity", operation: "add", value: 1, feedback: "The public record names its cost.", visibility: "visible" } },
    { targetKey: `choice:${compactChoice.entityId}`, kind: "add-item", collection: "effects", item: { id: "$new:resolve", mechanicKey: "resolve", operation: "add", value: 1, feedback: "The town commits to a shared repair.", visibility: "visible" } },
  ]);
  await applyGameEdit(call, projectId, consequences.proposalId);
  const page = await call("game_state", { projectId });
  const passages = await Promise.all(page.items.map((item: any) => read("passage", item.entityId)));
  const descriptions: Record<string, [string, string, string]> = {
    "passage-shared-opening": ["A Signal in the Rain", "A false signal calls Mira to the harbor tower.", "Rain rattles the signal glass. Below, a fishing boat answers a lamp you never lit. You take the council's sealed ledger from its damp shelf and carry it into the storm. Before another boat trusts that false light, someone must decide what the harbor is allowed to know."],
    "passage-shared-route-pivot": ["The Open Ledger", "Mira must choose public testimony or a transparent compact.", "At the quay, the ledger opens to a page of unpaid repairs. The council wants silence until the storm passes; the workers want the truth before they risk their lives. You can expose the record in public, or negotiate a repair that everyone can inspect. Neither choice will mend the tower without a cost."],
    "passage-route-1-act": ["The Public Quay", "Mira commits to public accountability and weighs evidence against urgency.", "You read the ledger aloud beneath the fish-market awning. Nobody cheers. Each entry names work left undone and a person now waiting beyond the breakwater. There is time to testify, time to inspect the last lamp, or time to send a warning that admits the tower may fall. There is not time to pretend the choices are free."],
    "passage-route-2-act": ["A Compact in Daylight", "Mira asks the town to share the repair openly.", "You lay the ledger between the council and the dockworkers. Every promise goes onto the same wet page: supplies, hours, names, and a public inspection when the water falls. Nobody receives a clean escape from blame. Yet hands begin to move together, and a rope rises toward the damaged tower."],
    "passage-ending-1": ["A Public Reckoning", "The harbor rebuilds trust through an honest public record.", "By morning, the ledger hangs in the market square. The beacon burns, and the people who repaired it stand beside the people who failed it. You sign your own decision beneath theirs. The harbor has not become innocent; it has become answerable. For the first time in years, that is enough to begin."],
    "passage-ending-2": ["A Shared Repair", "A transparent compact saves the tower without erasing responsibility.", "The last brace holds as the tide turns. At dawn, each worker reads the bargain and adds the cost that the council forgot. You keep the amended page beside the signal wheel. The light is no longer yours alone to promise. It belongs to the people who can question how it is kept."],
    "passage-ending-3": ["The Costly Warning", "Mira saves the boats while accepting the loss of the beacon.", "You send the warning without disguising its source. Boats turn toward the safe channel before the tower gives way. When the lamp vanishes, the harbor is already answering with its own lights. You cannot save the beacon, but you can record why it fell, and who lived because the final signal told the truth."],
  };
  descriptions[generated["$new:beacon"]] = ["The Last Lamp", "Mira verifies that the honest warning matters more than saving the tower.", "Inside the lens housing, a cracked shutter catches the light and repeats the false signal. You wedge it open with the ledger's brass seal. The mechanism will not survive another tide. Now you know exactly what the harbor must be told, and exactly what you must let go." ];
  const contentProposal = await proposeGameEdit(call, projectId, "Refine the exact scene titles, purposes and summaries for the original game", passages.map((p: any) => ({ key: `passage:${p.entityId}`, versionId: p.id })), passages.map((p: any) => ({
    targetKey: `passage:${p.entityId}`, kind: "set-fields", changes: { title: descriptions[p.entityId]![0], summary: descriptions[p.entityId]![1], purpose: descriptions[p.entityId]![1], draftingNotes: ["Use the authored text, preserve the graph and make civic costs legible."] },
  })));
  await applyGameEdit(call, projectId, contentProposal.proposalId);
  await approveGamePlan(call, projectId);
  const selections: Array<{ passageId: string; candidateDraftVersionId: string }> = [];
  for (const passage of passages) {
    const draft = await submitGameDraft(call, projectId, passage.entityId, descriptions[passage.entityId]![2]);
    await onCandidate?.(passage.entityId, draft);
    selections.push({ passageId: passage.entityId, candidateDraftVersionId: draft.draftVersionId });
  }
  await acceptGameDrafts(call, projectId, selections);
  const path = ["choice-passage-shared-opening-continue", "choice-passage-shared-route-pivot-continue", "choice-passage-route-1-act-ending-1"];
  const alternate = ["choice-passage-shared-opening-continue", generated["$new:compact"], "choice-passage-route-2-act-ending-2"];
  const detourPath = ["choice-passage-shared-opening-continue", "choice-passage-shared-route-pivot-continue", "choice-passage-route-1-act-continue", generated["$new:beacon-exit"]];
  const simulation = await call("simulate_game", { projectId, operationId: randomUUID(), headFingerprint: (await call("game_state", { projectId })).headFingerprint, choiceIds: path, expectedEndingId: "ending-1", approved: true });
  const readiness = await call("publication_readiness", { projectId });
  const compiled = await call("compile_game", { projectId, operationId: randomUUID(), headFingerprint: readiness.headFingerprint, fingerprint: readiness.fingerprint, approved: true });
  const exported = await call("export_game", { projectId, buildVersionId: compiled.buildVersionId, format: "standalone" });
  return { passages, selections, generated, graphProposalId: proposal.proposalId, path, alternate, detourPath, simulation, readiness, compiled, exported };
}
