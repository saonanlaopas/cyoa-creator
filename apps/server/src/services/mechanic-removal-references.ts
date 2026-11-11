import type { LongFormMechanicsPlan, WorldDefinition, WorldJournalTrigger } from "@story-to-cyoa/domain";
import type { ChoicePlan } from "@story-to-cyoa/pipeline";
import type { NativePlayerConfig } from "@story-to-cyoa/runtime";
import { mechanicKeyReferences } from "./conversational-mechanic-identities.js";

export function assertRemovedMechanicsUnreferenced(keys: ReadonlySet<string>, references: Array<{ key: string; owner: string }>) {
  const blockers = references.filter(ref => keys.has(ref.key));
  if (blockers.length) {
    const shown = blockers.slice(0, 6).map(({ key, owner }) => `${key} in ${owner}`);
    throw new Error(`edit_mechanic_removal_referenced: ${shown.join("; ")}${blockers.length > shown.length ? `; ${blockers.length - shown.length} more` : ""}. Review and update those references before removing the mechanic.`);
  }
}

export function mechanicPlanReferences(mechanics: LongFormMechanicsPlan) {
  return [
    ...mechanics.gates.flatMap(gate => gate.conditions.map(condition => ({ key: condition.mechanicKey, owner: `gate ${gate.id} condition ${condition.id}` }))),
    ...mechanics.choiceEffectPlans.flatMap(plan => plan.mechanicKeys.map(key => ({ key, owner: `effect plan ${plan.id}` }))),
  ];
}

export function choiceMechanicReferences(choice: ChoicePlan) {
  return [
    ...[...mechanicKeyReferences(choice.condition)].map(key => ({ key, owner: `choice ${choice.id} condition` })),
    ...choice.effects.map(effect => ({ key: effect.mechanicKey, owner: `choice ${choice.id} effect ${effect.id}` })),
  ];
}

export function worldMechanicReferences(world?: WorldDefinition, config?: NativePlayerConfig) {
  const refs: Array<{ key: string; owner: string }> = [];
  const conditions = (items: WorldJournalTrigger[], owner: string) => {
    for (const item of items) if (item.kind === "relationship" || item.kind === "stat") refs.push({ key: item.key, owner });
  };
  for (const item of config?.visibleMechanics ?? []) refs.push({ key: item.key, owner: "player configuration; update it in Publication and play" });
  if (!world?.enabled) return refs;
  const { progression, people, economy, journal } = world;
  for (const event of progression?.events ?? []) conditions(event.prerequisites, `World event ${event.id} prerequisites`);
  for (const transition of progression?.transitions ?? []) conditions(transition.prerequisites, `World chapter transition ${transition.id} prerequisites`);
  for (const override of people?.overrides ?? []) conditions(override.prerequisites, `World schedule override ${override.id} prerequisites`);
  for (const shop of economy?.shops ?? []) for (const offer of shop.offers) conditions(offer.prerequisites, `World shop ${shop.id} offer ${offer.id} prerequisites`);
  for (const [kind, rules] of [["gift", economy?.gifts], ["item use", economy?.uses]] as const) for (const rule of rules ?? []) {
    conditions(rule.prerequisites, `World ${kind} ${rule.id} prerequisites`);
    for (const effect of rule.effects.relationships) refs.push({ key: effect.key, owner: `World ${kind} ${rule.id} effects` });
  }
  for (const rule of economy?.eventEffects ?? []) for (const effect of rule.effects.relationships) refs.push({ key: effect.key, owner: `World event ${rule.eventId} economy effects` });
  for (const item of journal?.character ?? []) {
    refs.push({ key: item.key, owner: "World journal character visibility" });
    conditions(item.when, `World journal character visibility trigger for ${item.key}`);
  }
  for (const location of journal?.locations ?? []) conditions(location.when, `World journal location ${location.locationId}`);
  for (const entry of journal?.entries ?? []) conditions(entry.when, `World journal entry ${entry.id}`);
  for (const objective of journal?.objectives ?? []) {
    conditions(objective.when, `World journal objective ${objective.id} reveal`);
    conditions(objective.completeWhen, `World journal objective ${objective.id} completion`);
  }
  return refs;
}
