import { stableFingerprint, type NativeWorld } from "@story-to-cyoa/runtime";
import type { ChoicePlan, PassagePlan } from "./schemas/passage-plan.js";

/** Advisory only. These checks do not change snapshot validation or infer intent from prose. */
export function playerFlowDiagnostics(passages: PassagePlan[], choices: ChoicePlan[], world?: NativeWorld) {
  const findings: Array<{ code: string; entityId: string; message: string }> = [];
  const add = (code: string, entityId: string, message: string) => findings.push({ code, entityId, message });
  const listed = new Map(passages.map(passage => [passage.id, new Set(passage.choiceIds)]));
  const transitions = new Set(passages.filter(passage => passage.kind === "transition" && passage.choiceIds.length === 1).map(passage => passage.id));
  const byPassage = new Map(world?.locations.flatMap(location => location.passageId ? [[location.passageId, location.id] as const] : []));
  if (world?.introductionPassageId) byPassage.set(world.introductionPassageId, world.startLocationId);
  const connections = new Set(world?.connections.map(item => JSON.stringify([item.from, item.to])));
  const equivalent = new Map<string, ChoicePlan[]>();
  for (const choice of choices) {
    if (!listed.get(choice.sourcePassageId)?.has(choice.id) || !listed.has(choice.destinationPassageId)) continue;
    const signature = stableFingerprint({
      source: choice.sourcePassageId, destination: choice.destinationPassageId,
      condition: choice.condition, decisions: choice.sourceDecisionIds,
      effects: choice.effects.map(({ id: _id, ...effect }) => effect),
    });
    const peers = equivalent.get(signature) ?? [];
    peers.push(choice); equivalent.set(signature, peers);
    const duplicateTravel = !choice.effects.length && !choice.sourceDecisionIds.length
      && connections.has(JSON.stringify([byPassage.get(choice.sourcePassageId), byPassage.get(choice.destinationPassageId)]));
    if (duplicateTravel) add("choice.world-travel-duplicate", choice.id, "This choice reaches the same location as a directed World connection. Review whether both travel paths are intentional.");
    if (choice.unavailableBehavior === "hidden" && (!choice.condition || duplicateTravel
      || !choice.effects.length && !choice.sourceDecisionIds.length && transitions.has(choice.destinationPassageId)
      || choice.destinationPassageId === choice.sourcePassageId && !choice.effects.some(effect => effect.visibility === "visible" && effect.feedback.trim()))) {
      add("choice.hidden-scaffolding-exposure", choice.id, "Hidden only applies while a choice is unavailable. Check whether this choice is intended to appear when its conditions are met.");
    }
  }
  for (const group of equivalent.values()) {
    if (group.length < 2) continue;
    const ids = group.map(choice => choice.id).sort();
    add("choice.immediate-reconvergence", ids[0]!, `${ids.length} choices enter the same response passage with equivalent gates and effects. Review whether their labels alone provide enough distinction.`);
  }
  return findings.sort((a, b) => a.code.localeCompare(b.code) || a.entityId.localeCompare(b.entityId));
}
