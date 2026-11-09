import { z } from "zod";
import { previewWorldSuppressions, type NativePreviewStop, type NativeWorld } from "@story-to-cyoa/runtime";
import type { ChoicePlan, PassagePlan } from "./schemas/passage-plan.js";

const id = z.string().min(1).max(200);
export const NativePreviewSelectionSchema = z.object({
  passageIds: z.array(id).min(1).max(100),
  startPassageId: id,
  stopPassageId: id,
}).strict();
export type NativePreviewSelection = z.infer<typeof NativePreviewSelectionSchema>;

export function inspectNativePreviewBoundary(selection: NativePreviewSelection, passages: PassagePlan[], choices: ChoicePlan[], world?: NativeWorld) {
  const { passageIds, startPassageId, stopPassageId } = selection;
  const selected = new Set(passageIds), byId = new Map(passages.map(item => [item.id, item]));
  const blockers: Array<{ source: string; id: string; passageId: string; message: string }> = [];
  const block = (source: string, id: string, passageId: string, message: string) => blockers.push({ source, id, passageId, message });
  if (selected.size !== passageIds.length) block("selection", "duplicate", startPassageId, "Select each passage only once.");
  for (const id of selected) if (!byId.has(id)) block("selection", id, id, "Select a passage in the approved snapshot.");
  if (!selected.has(startPassageId)) block("start", startPassageId, startPassageId, "Include the preview start in the selection.");
  const stop = byId.get(stopPassageId);
  if (!selected.has(stopPassageId) || !stop || stop.terminal || stop.endingId !== null) {
    block("stop", stopPassageId, stopPassageId, "Select an included non-ending passage as the preview stop.");
  }
  const edge = (source: string, id: string, passageId: string) => {
    if (!selected.has(passageId)) block(source, id, passageId, `${source} ${id} references excluded passage ${passageId}. Include its destination or change the preview selection.`);
  };
  const condition = (item: ChoicePlan["condition"], choiceId: string): void => {
    if (item?.kind === "visit-count") edge("choice visit-count", choiceId, item.passageId);
    if (item?.kind === "not") condition(item.item, choiceId);
    if (item?.kind === "all" || item?.kind === "any") item.items.forEach(child => condition(child, choiceId));
  };
  const retained = choices.filter(choice => selected.has(choice.sourcePassageId) && choice.sourcePassageId !== stopPassageId);
  for (const choice of retained) {
    edge("choice", choice.id, choice.destinationPassageId);
    condition(choice.condition, choice.id);
  }
  const suppressedWorldCommands = previewWorldSuppressions(world);
  if (world) {
    const worldStart = world.locations.find(location => location.id === world.startLocationId)?.passageId;
    if (worldStart !== startPassageId) block("world start", world.startLocationId, worldStart ?? startPassageId, "Use the canonical World start passage for this preview.");
    for (const location of world.locations) if (location.passageId) edge("world location", location.id, location.passageId);
    for (const action of suppressedWorldCommands) if ("destinationPassageId" in action && action.destinationPassageId) {
      edge(`world ${action.kind}`, action.id, action.destinationPassageId);
    }
  }
  // Overapproximate World prerequisites; do not claim state-dependent reachability.
  const reachable = new Set([startPassageId]), queue = [startPassageId];
  for (const id of queue) {
    if (id === stopPassageId || byId.get(id)?.terminal) continue;
    const location = world?.locations.find(item => item.passageId === id);
    const destinations = retained.filter(choice => choice.sourcePassageId === id).map(choice => choice.destinationPassageId);
    if (world) {
      destinations.push(...world.connections.filter(item => !location || item.from === location.id)
        .flatMap(item => world.locations.find(target => target.id === item.to)?.passageId ?? []));
      destinations.push(...[...(world.progression?.events ?? []), ...(world.progression?.transitions ?? [])].flatMap(item => item.passageId ?? []));
    }
    for (const destination of destinations) if (selected.has(destination) && !reachable.has(destination)) {
      reachable.add(destination); queue.push(destination);
    }
  }
  if (!reachable.has(stopPassageId)) block("stop", stopPassageId, stopPassageId, "The preview stop has no structural path from the start.");
  const boundary: NativePreviewStop = {
    stopPassageId,
    suppressedChoices: choices.filter(choice => choice.sourcePassageId === stopPassageId)
      .map(choice => ({ id: choice.id, destinationPassageId: choice.destinationPassageId })).sort((a, b) => a.id.localeCompare(b.id)),
    suppressedWorldCommands,
  };
  return { blockers, boundary };
}
