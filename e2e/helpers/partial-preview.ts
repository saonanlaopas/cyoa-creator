import { randomUUID } from "node:crypto";
import { acceptGameDrafts, applyGameEdit, approveGamePlan, proposeGameEdit, submitGameDraft } from "./connected-text-game.js";
import { completeOriginalFoundations, type FoundationCall } from "./original-foundations.js";
import { authoredWorld } from "./world.js";

export const previewStart = "passage-shared-opening";
export const previewStop = "passage-shared-route-pivot";
export const previewChoice = "choice-passage-shared-opening-continue";
export const openingProse = "Rain rattles the signal glass. Mira carries the sealed ledger through the harbor toward the quay.";
export const boundaryProse = "Under the quay lamp, Mira opens the ledger to a page of unpaid repairs. The tide turns below.";
export const openingSelection = { passageIds: [previewStart, previewStop], startPassageId: previewStart, stopPassageId: previewStop };

export async function initializePreviewOpening(call: FoundationCall, projectId: string) {
  await completeOriginalFoundations(call, projectId);
  const { headFingerprint } = await call("game_state", { projectId });
  await call("initialize_game_plan", { projectId, operationId: randomUUID(), headFingerprint, approved: true });
  const { record } = await call("read_game_record", { projectId, kind: "choice", entityId: previewChoice });
  const key = `choice:${previewChoice}`;
  const proposal = await proposeGameEdit(call, projectId, "The commitment to investigate strengthens Mira's resolve", [{ key, versionId: record.id }], [
    { targetKey: key, kind: "add-item", collection: "effects", item: { id: "$new:opening-resolve", mechanicKey: "resolve",
      operation: "add", value: 1, feedback: "Mira commits to the investigation.", visibility: "visible" } },
  ]);
  await applyGameEdit(call, projectId, proposal.proposalId);
  await approveGamePlan(call, projectId);
  const opening = await submitGameDraft(call, projectId, previewStart, openingProse);
  const boundary = await submitGameDraft(call, projectId, previewStop, boundaryProse);
  return [
    { passageId: previewStart, candidateDraftVersionId: opening.draftVersionId },
    { passageId: previewStop, candidateDraftVersionId: boundary.draftVersionId },
  ];
}

export async function completePreviewOpening(call: FoundationCall, projectId: string) {
  const candidates = await initializePreviewOpening(call, projectId);
  await acceptGameDrafts(call, projectId, candidates);
}

export async function previewWorld(call: FoundationCall, projectId: string, mapImage?: Parameters<typeof authoredWorld>[2]) {
  const world = await authoredWorld(call, projectId, mapImage);
  return {
    ...world,
    locations: world.locations.filter(location => location.id !== "station"),
    connections: world.connections.filter(connection => connection.from !== "station" && connection.to !== "station"),
    actions: [{ ...world.actions[0]!, locationId: "cafe" }],
  };
}

export async function applyPreviewWorld(call: FoundationCall, projectId: string, world: Awaited<ReturnType<typeof previewWorld>>) {
  const { fingerprint } = await call("review_world", { projectId, world });
  return call("apply_world", { projectId, operationId: randomUUID(), fingerprint, approved: true, world });
}
