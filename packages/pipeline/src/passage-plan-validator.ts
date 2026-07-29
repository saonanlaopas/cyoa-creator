import type { LongFormEndingPlan } from "./schemas/long-form-ending-plan.js";
import type { LongFormMechanicsPlan } from "./schemas/long-form-mechanics-plan.js";
import type { LongFormRoutePlan } from "./schemas/long-form-route-plan.js";
import type { LongFormStoryBible } from "./schemas/long-form-story-bible.js";
import type {
  ChoicePlan, ConditionExpression, PassagePlan, PassagePlanBundle, StateEffect,
} from "./schemas/passage-plan.js";

export type PassageFindingSeverity = "error" | "warning" | "info";
export interface PassageFindingOverride {
  code: string;
  entityId: string;
  rationale: string;
}
export interface PassagePlanFinding {
  code: string;
  severity: PassageFindingSeverity;
  entityType: "project" | "act" | "sequence" | "passage" | "choice" | "thread" | "mechanic" | "ending";
  entityId: string;
  message: string;
  evidence: string[];
  suggestion: string;
  acknowledged: boolean;
  overrideRationale?: string;
}
export interface PassageBudgetReport {
  project: { target: number; planned: number; difference: number };
  acts: Array<{ id: string; target: number; planned: number; difference: number }>;
  sequences: Array<{ id: string; target: number; planned: number; difference: number }>;
  routes: Array<{ id: string; target: number; planned: number; difference: number }>;
}
export interface PassageCoverageReport {
  reachablePassageIds: string[];
  unreachablePassageIds: string[];
  endingCoverage: Array<{ endingId: string; incomingPassageIds: string[]; plausible: boolean }>;
  routeCoverage: Array<{ routeId: string; passageCount: number; endingCount: number }>;
  pathWords: { minimum: number | null; maximum: number | null; representative: number | null; truncated: boolean };
  mechanicCoverage: Array<{ key: string; reads: string[]; writes: string[] }>;
}
export interface PassageValidationReport {
  findings: PassagePlanFinding[];
  budgets: PassageBudgetReport;
  coverage: PassageCoverageReport;
}

type MechanicKind = "number" | "boolean" | "string";
type MechanicDefinition = { kind: MechanicKind; minimum?: number; maximum?: number };

const findingKey = (finding: Pick<PassagePlanFinding, "code" | "entityId">) =>
  `${finding.code}:${finding.entityId}`;

function conditionReads(condition: ConditionExpression | null, target: string[] = []): string[] {
  if (!condition) return target;
  if (condition.kind === "compare") target.push(condition.mechanicKey);
  else if (condition.kind === "not") conditionReads(condition.item, target);
  else if (condition.kind === "all" || condition.kind === "any") condition.items.forEach((item) => conditionReads(item, target));
  return target;
}

function conditionVisitReferences(condition: ConditionExpression | null, target: string[] = []): string[] {
  if (!condition) return target;
  if (condition.kind === "visit-count") target.push(condition.passageId);
  else if (condition.kind === "not") conditionVisitReferences(condition.item, target);
  else if (condition.kind === "all" || condition.kind === "any") condition.items.forEach((item) => conditionVisitReferences(item, target));
  return target;
}

function conditionDefinitelyImpossible(
  condition: ConditionExpression | null,
  mechanics: Map<string, MechanicDefinition>,
): boolean {
  if (!condition) return false;
  if (condition.kind === "all") return condition.items.some((item) => conditionDefinitelyImpossible(item, mechanics));
  if (condition.kind === "any") return condition.items.every((item) => conditionDefinitelyImpossible(item, mechanics));
  if (condition.kind === "not" || condition.kind === "visit-count") return false;
  const definition = mechanics.get(condition.mechanicKey);
  if (!definition || definition.kind !== "number" || typeof condition.value !== "number") return false;
  if (condition.operator === "gt" && definition.maximum !== undefined) return condition.value >= definition.maximum;
  if (condition.operator === "gte" && definition.maximum !== undefined) return condition.value > definition.maximum;
  if (condition.operator === "lt" && definition.minimum !== undefined) return condition.value <= definition.minimum;
  if (condition.operator === "lte" && definition.minimum !== undefined) return condition.value < definition.minimum;
  if (condition.operator === "eq" && definition.minimum !== undefined && definition.maximum !== undefined) {
    return condition.value < definition.minimum || condition.value > definition.maximum;
  }
  return false;
}

function mechanicRegistry(mechanics: LongFormMechanicsPlan | null): Map<string, MechanicDefinition> {
  const registry = new Map<string, MechanicDefinition>();
  mechanics?.visibleStats.forEach((item) => registry.set(item.key, { kind: "number", minimum: item.minimum, maximum: item.maximum }));
  mechanics?.relationships.forEach((item) => registry.set(item.key, { kind: "number", minimum: item.minimum, maximum: item.maximum }));
  mechanics?.flags.forEach((item) => registry.set(item.key, { kind: "boolean" }));
  mechanics?.resources.forEach((item) => registry.set(item.key, { kind: item.kind === "inventory" ? "string" : "number" }));
  return registry;
}

function effectCompatible(effect: StateEffect, definition: MechanicDefinition | undefined): boolean {
  if (!definition) return false;
  if (definition.kind === "boolean") return (effect.operation === "set" && typeof effect.value === "boolean") || effect.operation === "clear";
  if (definition.kind === "number") {
    if (!["set", "add", "subtract"].includes(effect.operation) || typeof effect.value !== "number") return false;
    return effect.operation !== "set" || definition.minimum === undefined || definition.maximum === undefined
      || (effect.value >= definition.minimum && effect.value <= definition.maximum);
  }
  return effect.operation === "set" && typeof effect.value === "string";
}

function conditionCompatible(condition: ConditionExpression | null, registry: Map<string, MechanicDefinition>): boolean {
  if (!condition) return true;
  if (condition.kind === "all" || condition.kind === "any") return condition.items.every((item) => conditionCompatible(item, registry));
  if (condition.kind === "not" || condition.kind === "visit-count") return condition.kind === "visit-count" || conditionCompatible(condition.item, registry);
  const definition = registry.get(condition.mechanicKey);
  if (!definition) return false;
  if (["gt", "gte", "lt", "lte"].includes(condition.operator)) return definition.kind === "number" && typeof condition.value === "number";
  return typeof condition.value === definition.kind;
}

function reachable(startId: string | null, outgoing: Map<string, ChoicePlan[]>): Set<string> {
  const seen = new Set<string>();
  if (!startId) return seen;
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    outgoing.get(id)?.forEach((choice) => queue.push(choice.destinationPassageId));
  }
  return seen;
}

function stronglyConnected(passages: PassagePlan[], outgoing: Map<string, ChoicePlan[]>): string[][] {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lows = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];
  const visit = (id: string): void => {
    indexes.set(id, nextIndex); lows.set(id, nextIndex); nextIndex += 1;
    stack.push(id); onStack.add(id);
    for (const choice of outgoing.get(id) ?? []) {
      const child = choice.destinationPassageId;
      if (!indexes.has(child)) {
        visit(child);
        lows.set(id, Math.min(lows.get(id)!, lows.get(child)!));
      } else if (onStack.has(child)) lows.set(id, Math.min(lows.get(id)!, indexes.get(child)!));
    }
    if (lows.get(id) === indexes.get(id)) {
      const component: string[] = [];
      let member = "";
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== id);
      result.push(component);
    }
  };
  passages.forEach((passage) => { if (!indexes.has(passage.id)) visit(passage.id); });
  return result;
}

function pathWordCounts(
  startId: string | null,
  passages: Map<string, PassagePlan>,
  outgoing: Map<string, ChoicePlan[]>,
): PassageCoverageReport["pathWords"] {
  if (!startId || !passages.has(startId)) return { minimum: null, maximum: null, representative: null, truncated: false };
  const totals: number[] = [];
  let truncated = false;
  const walk = (id: string, visited: Set<string>, total: number): void => {
    if (totals.length >= 2_000) { truncated = true; return; }
    const passage = passages.get(id);
    if (!passage) return;
    const nextTotal = total + passage.wordTarget;
    const choices = outgoing.get(id) ?? [];
    if (passage.terminal || choices.length === 0) {
      totals.push(nextTotal);
      return;
    }
    for (const choice of choices) {
      if (visited.has(choice.destinationPassageId)) {
        truncated = true;
        continue;
      }
      walk(choice.destinationPassageId, new Set([...visited, choice.destinationPassageId]), nextTotal);
    }
  };
  walk(startId, new Set([startId]), 0);
  if (!totals.length) return { minimum: null, maximum: null, representative: null, truncated };
  totals.sort((a, b) => a - b);
  return {
    minimum: totals[0]!, maximum: totals.at(-1)!,
    representative: totals[Math.floor(totals.length / 2)]!, truncated,
  };
}

export function passageBudgetReport(
  bundle: PassagePlanBundle,
  routes: LongFormRoutePlan | null,
): PassageBudgetReport {
  const passagesBySequence = new Map<string, PassagePlan[]>();
  bundle.passages.forEach((passage) => passagesBySequence.set(
    passage.sequenceId, [...(passagesBySequence.get(passage.sequenceId) ?? []), passage],
  ));
  const sequencePlanned = new Map(bundle.structure.sequences.map((sequence) =>
    [sequence.id, (passagesBySequence.get(sequence.id) ?? []).reduce((sum, passage) => sum + passage.wordTarget, 0)]));
  const actPlanned = new Map(bundle.structure.acts.map((act) =>
    [act.id, bundle.structure.sequences.filter((sequence) => sequence.actId === act.id)
      .reduce((sum, sequence) => sum + (sequencePlanned.get(sequence.id) ?? 0), 0)]));
  const projectPlanned = bundle.passages.reduce((sum, passage) => sum + passage.wordTarget, 0);
  const routeTargets = new Map<string, number>();
  routes?.acts.filter((act) => act.routeId).forEach((act) =>
    routeTargets.set(act.routeId!, (routeTargets.get(act.routeId!) ?? 0) + act.wordTarget));
  return {
    project: { target: bundle.structure.projectWordTarget, planned: projectPlanned, difference: bundle.structure.projectWordTarget - projectPlanned },
    acts: bundle.structure.acts.map((act) => ({ id: act.id, target: act.wordTarget, planned: actPlanned.get(act.id) ?? 0, difference: act.wordTarget - (actPlanned.get(act.id) ?? 0) })),
    sequences: bundle.structure.sequences.map((sequence) => ({ id: sequence.id, target: sequence.wordTarget, planned: sequencePlanned.get(sequence.id) ?? 0, difference: sequence.wordTarget - (sequencePlanned.get(sequence.id) ?? 0) })),
    routes: [...routeTargets].map(([id, target]) => {
      const planned = bundle.passages.filter((passage) => passage.routeIds.includes(id)).reduce((sum, passage) => sum + passage.wordTarget, 0);
      return { id, target, planned, difference: target - planned };
    }),
  };
}

export function validatePassagePlan(input: {
  bundle: PassagePlanBundle;
  bible: LongFormStoryBible | null;
  routes: LongFormRoutePlan | null;
  endings: LongFormEndingPlan | null;
  mechanics: LongFormMechanicsPlan | null;
  overrides?: PassageFindingOverride[];
}): PassageValidationReport {
  const { bundle, bible, routes, endings, mechanics } = input;
  const overrides = new Map((input.overrides ?? []).map((item) => [`${item.code}:${item.entityId}`, item.rationale]));
  const findings: PassagePlanFinding[] = [];
  const add = (finding: Omit<PassagePlanFinding, "acknowledged" | "overrideRationale">): void => {
    const rationale = overrides.get(findingKey(finding));
    findings.push({ ...finding, acknowledged: Boolean(rationale), ...(rationale ? { overrideRationale: rationale } : {}) });
  };
  const passageById = new Map(bundle.passages.map((item) => [item.id, item]));
  const choiceById = new Map(bundle.choices.map((item) => [item.id, item]));
  const threadById = new Map(bundle.threads.map((item) => [item.id, item]));
  const sequenceIds = new Set(bundle.structure.sequences.map((item) => item.id));
  const routeIds = new Set(routes?.routes.map((item) => item.id) ?? []);
  const endingIds = new Set(endings?.endings.map((item) => item.id) ?? []);
  const characterIds = new Set(bible?.characters.map((item) => item.id) ?? []);
  const relationshipIds = new Set(bible?.relationships.map((item) => item.id) ?? []);
  const factIds = new Set(bible?.canonFacts.map((item) => item.id) ?? []);
  const registry = mechanicRegistry(mechanics);
  const allIds = [
    ...bundle.structure.acts.map((item) => item.id), ...bundle.structure.sequences.map((item) => item.id),
    ...bundle.passages.map((item) => item.id), ...bundle.choices.map((item) => item.id), ...bundle.threads.map((item) => item.id),
  ];
  const duplicates = allIds.filter((id, index) => allIds.indexOf(id) !== index);
  [...new Set(duplicates)].forEach((id) => add({
    code: "reference.duplicate-id", severity: "error", entityType: "project", entityId: id,
    message: `Stable ID ${id} is duplicated.`, evidence: [id], suggestion: "Assign a unique stable ID.",
  }));
  const outgoing = new Map<string, ChoicePlan[]>();
  const incoming = new Map<string, ChoicePlan[]>();
  bundle.choices.forEach((choice) => {
    outgoing.set(choice.sourcePassageId, [...(outgoing.get(choice.sourcePassageId) ?? []), choice]);
    incoming.set(choice.destinationPassageId, [...(incoming.get(choice.destinationPassageId) ?? []), choice]);
    if (!passageById.has(choice.sourcePassageId)) add({
      code: "choice.source.missing", severity: "error", entityType: "choice", entityId: choice.id,
      message: "Choice source passage is missing.", evidence: [choice.sourcePassageId], suggestion: "Select an existing source passage.",
    });
    if (!passageById.has(choice.destinationPassageId)) add({
      code: "choice.destination.missing", severity: "error", entityType: "choice", entityId: choice.id,
      message: "Choice destination passage is missing.", evidence: [choice.destinationPassageId], suggestion: "Select an existing destination passage.",
    });
    conditionVisitReferences(choice.condition).filter((id) => !passageById.has(id)).forEach((id) => add({
      code: "condition.visit-passage.missing", severity: "error", entityType: "choice", entityId: choice.id,
      message: "Visit-count condition references a missing passage.", evidence: [id], suggestion: "Select an existing passage.",
    }));
    if (!conditionCompatible(choice.condition, registry)) add({
      code: "condition.type.invalid", severity: "error", entityType: "choice", entityId: choice.id,
      message: "Choice condition is incompatible with the mechanics registry.", evidence: conditionReads(choice.condition),
      suggestion: "Use a compatible mechanic, comparator, and value.",
    });
    if (conditionDefinitelyImpossible(choice.condition, registry)) add({
      code: "condition.threshold.unreachable", severity: "warning", entityType: "choice", entityId: choice.id,
      message: "The choice condition appears unreachable within declared mechanic bounds.", evidence: conditionReads(choice.condition),
      suggestion: "Adjust the threshold or mechanic bounds.",
    });
    choice.effects.forEach((effect) => {
      if (!effectCompatible(effect, registry.get(effect.mechanicKey))) add({
        code: "effect.type.invalid", severity: "error", entityType: "choice", entityId: choice.id,
        message: `Effect ${effect.id} is incompatible with mechanic ${effect.mechanicKey}.`, evidence: [effect.id, effect.mechanicKey],
        suggestion: "Use an operation and value compatible with the mechanic type.",
      });
    });
  });
  if (!bundle.structure.startPassageId || !passageById.has(bundle.structure.startPassageId)) add({
    code: "graph.start.invalid", severity: "error", entityType: "project", entityId: "passage-plan",
    message: "The passage plan has no valid start passage.", evidence: [bundle.structure.startPassageId ?? "(none)"],
    suggestion: "Choose an existing passage as the start.",
  });
  bundle.passages.forEach((passage) => {
    if (!sequenceIds.has(passage.sequenceId)) add({
      code: "passage.sequence.missing", severity: "error", entityType: "passage", entityId: passage.id,
      message: "Passage belongs to a missing sequence.", evidence: [passage.sequenceId], suggestion: "Move it to an existing sequence.",
    });
    passage.choiceIds.forEach((id) => {
      const choice = choiceById.get(id);
      if (!choice || choice.sourcePassageId !== passage.id) add({
        code: "passage.choice.invalid", severity: "error", entityType: "passage", entityId: passage.id,
        message: "Passage choice list contains a missing or differently owned choice.", evidence: [id],
        suggestion: "Repair the choice ownership reference.",
      });
    });
    if (passage.terminal && passage.choiceIds.length) add({
      code: "graph.terminal.outgoing", severity: "error", entityType: "passage", entityId: passage.id,
      message: "Terminal passages cannot have outgoing choices.", evidence: passage.choiceIds, suggestion: "Remove choices or clear terminal status.",
    });
    if (!passage.terminal && passage.choiceIds.length === 0) add({
      code: "graph.dead-end.accidental", severity: "error", entityType: "passage", entityId: passage.id,
      message: "Nonterminal passage has no outgoing choice.", evidence: [], suggestion: "Add a choice or mark it terminal.",
    });
    if (!passage.terminal && passage.choiceIds.length > 0
      && passage.choiceIds.every((id) => conditionDefinitelyImpossible(choiceById.get(id)?.condition ?? null, registry))) add({
      code: "graph.choice.none-plausible", severity: "error", entityType: "passage", entityId: passage.id,
      message: "No outgoing choice appears available under any plausible state.", evidence: passage.choiceIds,
      suggestion: "Add an unconditional fallback or repair gate thresholds.",
    });
    if (passage.endingId && (!passage.terminal || !endingIds.has(passage.endingId))) add({
      code: "ending.link.invalid", severity: "error", entityType: "passage", entityId: passage.id,
      message: "Ending-linked passages must be terminal and reference an approved ending.", evidence: [passage.endingId],
      suggestion: "Select an approved ending and mark the passage terminal.",
    });
    passage.routeIds.filter((id) => !routeIds.has(id)).forEach((id) => add({
      code: "passage.route.missing", severity: "error", entityType: "passage", entityId: passage.id,
      message: "Passage references an unknown route.", evidence: [id], suggestion: "Select an approved route.",
    }));
    passage.characterIds.filter((id) => !characterIds.has(id)).forEach((id) => add({
      code: "passage.character.missing", severity: "error", entityType: "passage", entityId: passage.id,
      message: "Passage references an unknown character.", evidence: [id], suggestion: "Select a story-bible character.",
    }));
    passage.relationshipIds.filter((id) => !relationshipIds.has(id)).forEach((id) => add({
      code: "passage.relationship.missing", severity: "error", entityType: "passage", entityId: passage.id,
      message: "Passage references an unknown relationship.", evidence: [id], suggestion: "Select a story-bible relationship.",
    }));
    passage.requiredFactIds.filter((id) => !factIds.has(id)).forEach((id) => add({
      code: "passage.fact.missing", severity: "error", entityType: "passage", entityId: passage.id,
      message: "Passage requires an unknown canon fact.", evidence: [id], suggestion: "Select a story-bible fact.",
    }));
    [...passage.setupThreadIds, ...passage.payoffThreadIds].filter((id) => !threadById.has(id)).forEach((id) => add({
      code: "passage.thread.missing", severity: "error", entityType: "passage", entityId: passage.id,
      message: "Passage references an unknown narrative thread.", evidence: [id], suggestion: "Create or select a narrative thread.",
    }));
  });
  const reached = reachable(bundle.structure.startPassageId, outgoing);
  bundle.passages.filter((passage) => !reached.has(passage.id)).forEach((passage) => add({
    code: "graph.passage.unreachable", severity: "warning", entityType: "passage", entityId: passage.id,
    message: "Passage is unreachable from the selected start under structural analysis.", evidence: [], suggestion: "Add an incoming choice or remove it.",
  }));
  stronglyConnected(bundle.passages, outgoing).filter((component) =>
    component.length > 1 || (outgoing.get(component[0]!) ?? []).some((choice) => choice.destinationPassageId === component[0]))
    .forEach((component) => {
      const members = new Set(component);
      const hasExit = component.some((id) => (outgoing.get(id) ?? []).some((choice) => !members.has(choice.destinationPassageId)));
      add({
        code: hasExit ? "graph.cycle.controlled" : "graph.cycle.uncontrolled",
        severity: hasExit ? "info" : "error", entityType: "passage", entityId: component[0]!,
        message: hasExit ? "Cycle has at least one structural exit." : "Cycle has no structural exit.",
        evidence: component, suggestion: hasExit ? "Review visit-count or state controls." : "Add an exit or remove the cycle.",
      });
    });
  bundle.threads.forEach((thread) => {
    if (thread.setupPassageIds.length === 0 && thread.payoffPassageIds.length > 0) add({
      code: "continuity.thread.payoff-without-setup", severity: "warning", entityType: "thread", entityId: thread.id,
      message: "Narrative thread has payoff passages but no setup.", evidence: thread.payoffPassageIds, suggestion: "Add an earlier setup or waive the warning.",
    });
    if (thread.setupPassageIds.length > 0 && thread.payoffPassageIds.length === 0 && thread.status !== "waived") add({
      code: "continuity.thread.setup-without-payoff", severity: "warning", entityType: "thread", entityId: thread.id,
      message: "Narrative thread is set up but has no payoff.", evidence: thread.setupPassageIds, suggestion: "Add a payoff or record a waiver.",
    });
  });
  const revealing = new Map<string, Set<string>>();
  bundle.passages.forEach((passage) => passage.revealedFactIds.forEach((fact) =>
    revealing.set(fact, new Set([...(revealing.get(fact) ?? []), passage.id]))));
  bundle.passages.forEach((passage) => passage.requiredFactIds.forEach((fact) => {
    if (!(revealing.get(fact)?.size)) add({
      code: "continuity.fact.used-before-revelation", severity: "warning", entityType: "passage", entityId: passage.id,
      message: "A required fact has no reachable planned revelation.", evidence: [fact], suggestion: "Reveal the fact earlier or remove the requirement.",
    });
  }));
  bundle.structure.characterAvailability.forEach((availability) => {
    bundle.passages.filter((passage) => passage.characterIds.includes(availability.characterId)).forEach((passage) => {
      const sequence = bundle.structure.sequences.find((item) => item.id === passage.sequenceId);
      const outsideAct = availability.actIds.length > 0 && (!sequence || !availability.actIds.includes(sequence.actId));
      const outsideRoute = availability.routeIds.length > 0 && !passage.routeIds.some((id) => availability.routeIds.includes(id));
      if (outsideAct || outsideRoute) add({
        code: "continuity.character.outside-availability", severity: "warning", entityType: "passage", entityId: passage.id,
        message: `Character ${availability.characterId} appears outside declared availability.`, evidence: [availability.characterId],
        suggestion: "Adjust the passage or availability declaration.",
      });
    });
  });
  const differenceUses = new Map<string, string[]>();
  bundle.passages.forEach((passage) => passage.preservedDifferenceIds.forEach((id) =>
    differenceUses.set(id, [...(differenceUses.get(id) ?? []), passage.id])));
  differenceUses.forEach((ids, id) => {
    if (ids.length < 2) add({
      code: "continuity.difference.disappears", severity: "warning", entityType: "passage", entityId: ids[0]!,
      message: `Preserved difference ${id} has no later declared continuation.`, evidence: ids,
      suggestion: "Carry it into a later passage, mechanic read, or ending contribution.",
    });
  });
  const mechanicCoverage = [...registry.keys()].map((key) => ({
    key,
    reads: bundle.choices.filter((choice) => conditionReads(choice.condition).includes(key)).map((choice) => choice.id),
    writes: bundle.choices.filter((choice) => choice.effects.some((effect) => effect.mechanicKey === key)).map((choice) => choice.id),
  }));
  mechanicCoverage.forEach((coverage) => {
    if (!coverage.reads.length) add({
      code: "mechanic.never-read", severity: "warning", entityType: "mechanic", entityId: coverage.key,
      message: `Mechanic ${coverage.key} is never read by a choice condition.`, evidence: coverage.writes,
      suggestion: "Add a meaningful gate or remove the mechanic.",
    });
    if (!coverage.writes.length) add({
      code: "mechanic.never-written", severity: "warning", entityType: "mechanic", entityId: coverage.key,
      message: `Mechanic ${coverage.key} is never changed by a choice.`, evidence: coverage.reads,
      suggestion: "Add a meaningful effect or remove the mechanic.",
    });
  });
  const endingCoverage = (endings?.endings ?? []).map((ending) => {
    const incomingPassageIds = bundle.passages.filter((passage) => passage.endingId === ending.id)
      .filter((passage) => reached.has(passage.id))
      .map((passage) => passage.id);
    const plausible = incomingPassageIds.length > 0;
    if (!plausible) add({
      code: "ending.path.none-plausible", severity: "warning", entityType: "ending", entityId: ending.id,
      message: "Approved ending has no plausible incoming passage path.", evidence: [], suggestion: "Link a reachable terminal passage to this ending.",
    });
    return { endingId: ending.id, incomingPassageIds, plausible };
  });
  const routeCoverage = (routes?.routes ?? []).map((route) => ({
    routeId: route.id,
    passageCount: bundle.passages.filter((passage) => passage.routeIds.includes(route.id)).length,
    endingCount: endingCoverage.filter((coverage) => {
      const ending = endings?.endings.find((item) => item.id === coverage.endingId);
      return ending?.routeId === route.id && coverage.plausible;
    }).length,
  }));
  const budgets = passageBudgetReport(bundle, routes);
  budgets.sequences.filter((item) => item.target > 0 && Math.abs(item.difference) / item.target > 0.25).forEach((item) => add({
    code: "budget.sequence.outside-target", severity: "warning", entityType: "sequence", entityId: item.id,
    message: "Sequence planned words differ from its target by more than 25%.", evidence: [`target=${item.target}`, `planned=${item.planned}`],
    suggestion: "Rebalance passage word targets or the sequence budget.",
  }));
  const pathWords = pathWordCounts(bundle.structure.startPassageId, passageById, outgoing);
  if (pathWords.representative !== null
    && Math.abs(pathWords.representative - bundle.structure.typicalPathWordTarget) / bundle.structure.typicalPathWordTarget > 0.25) add({
    code: "budget.path.outside-target", severity: "warning", entityType: "project", entityId: "passage-plan",
    message: "Representative path length differs from the typical playthrough target by more than 25%.",
    evidence: [`target=${bundle.structure.typicalPathWordTarget}`, `representative=${pathWords.representative}`],
    suggestion: "Rebalance shared and route-exclusive passage budgets.",
  });
  const severityOrder = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    || a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId) || a.code.localeCompare(b.code));
  return {
    findings, budgets,
    coverage: {
      reachablePassageIds: [...reached],
      unreachablePassageIds: bundle.passages.filter((passage) => !reached.has(passage.id)).map((passage) => passage.id),
      endingCoverage, routeCoverage, pathWords, mechanicCoverage,
    },
  };
}
