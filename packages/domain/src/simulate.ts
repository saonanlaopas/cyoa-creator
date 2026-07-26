import { applyEffects, isConditionMet, StoryStateSchema, type StoryState } from "./mechanics.js";
import type { Project } from "./project.js";

export interface SimulationLimits {
  maxStates?: number;
  maxPathLength?: number;
  maxVisitsPerPassage?: number;
}

export interface SimulatedPath {
  passageIds: string[];
  endingId?: string;
  finalState: StoryState;
  terminatedBy: "ending" | "dead-end" | "loop" | "limit";
}

export interface NumericRange {
  min: number;
  max: number;
}

export interface SimulationReport {
  reachableEndingIds: string[];
  unreachableEndingIds: string[];
  paths: SimulatedPath[];
  loops: Array<{ passageId: string; passageIds: string[] }>;
  impossibleChoices: Array<{ passageId: string; choiceId: string }>;
  pathLengths: { min: number; max: number; average: number };
  statRanges: Record<string, NumericRange>;
  relationshipRanges: Record<string, NumericRange>;
  exploredStates: number;
  equivalentStatesCollapsed: number;
  exhaustive: boolean;
  truncated: boolean;
  truncationReasons: Array<"maxStates" | "maxPathLength" | "maxVisitsPerPassage">;
}

interface SearchNode {
  passageId: string;
  state: StoryState;
  path: string[];
  visits: Record<string, number>;
}

function stableObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function stateKey(passageId: string, state: StoryState): string {
  return JSON.stringify({
    passageId,
    stats: stableObject(state.stats),
    relationships: stableObject(state.relationships),
    flags: stableObject(state.flags),
    inventory: [...state.inventory].sort(),
    pendingEffects: state.pendingEffects.map((pending) => ({
      remaining: pending.remaining,
      effect: pending.effect,
    })),
  });
}

function updateRanges(target: Record<string, NumericRange>, values: Record<string, number>): void {
  for (const [key, value] of Object.entries(values)) {
    const existing = target[key];
    target[key] = existing
      ? { min: Math.min(existing.min, value), max: Math.max(existing.max, value) }
      : { min: value, max: value };
  }
}

function initialState(project: Project): StoryState {
  return StoryStateSchema.parse({
    stats: Object.fromEntries(Object.entries(project.mechanics.visibleStats).map(([key, stat]) => [key, stat.initial])),
    relationships: Object.fromEntries(
      Object.entries(project.mechanics.relationships).map(([key, relationship]) => [key, relationship.initial]),
    ),
    flags: project.mechanics.hiddenFlags,
    inventory: [],
  });
}

export function simulateProject(project: Project, limits: SimulationLimits = {}): SimulationReport {
  const maxStates = limits.maxStates ?? 10_000;
  const maxPathLength = limits.maxPathLength ?? 100;
  const maxVisitsPerPassage = limits.maxVisitsPerPassage ?? 3;
  const passages = new Map(project.passages.map((passage) => [passage.id as string, passage]));
  const queue: SearchNode[] = [{
    passageId: project.startPassageId,
    state: initialState(project),
    path: [],
    visits: {},
  }];
  const seen = new Set<string>();
  const paths: SimulatedPath[] = [];
  const loops: SimulationReport["loops"] = [];
  const reachableEndings = new Set<string>();
  const choiceAttempts = new Map<string, { met: number; unmet: number }>();
  const statRanges: Record<string, NumericRange> = {};
  const relationshipRanges: Record<string, NumericRange> = {};
  const truncationReasons = new Set<SimulationReport["truncationReasons"][number]>();
  let equivalentStatesCollapsed = 0;

  while (queue.length) {
    if (seen.size >= maxStates) {
      truncationReasons.add("maxStates");
      break;
    }
    const node = queue.shift()!;
    const passage = passages.get(node.passageId);
    if (!passage) continue;
    const state = applyEffects(node.state, []);
    const path = [...node.path, node.passageId];
    const visits = { ...node.visits, [node.passageId]: (node.visits[node.passageId] ?? 0) + 1 };
    const key = stateKey(node.passageId, state);
    if (seen.has(key)) {
      equivalentStatesCollapsed += 1;
      continue;
    }
    seen.add(key);
    updateRanges(statRanges, state.stats);
    updateRanges(relationshipRanges, state.relationships);

    const ending = passage.ending ?? passage.endingClassification;
    if (ending) {
      reachableEndings.add(passage.id);
      paths.push({ passageIds: path, endingId: passage.id, finalState: state, terminatedBy: "ending" });
      continue;
    }
    if (path.length >= maxPathLength) {
      truncationReasons.add("maxPathLength");
      paths.push({ passageIds: path, finalState: state, terminatedBy: "limit" });
      continue;
    }

    let availableChoices = 0;
    for (const choice of passage.choices) {
      const choiceKey = `${passage.id}\0${choice.id}`;
      const attempt = choiceAttempts.get(choiceKey) ?? { met: 0, unmet: 0 };
      const met = choice.conditions.every((condition) => isConditionMet(state, condition));
      if (!met) {
        attempt.unmet += 1;
        choiceAttempts.set(choiceKey, attempt);
        continue;
      }
      attempt.met += 1;
      choiceAttempts.set(choiceKey, attempt);
      availableChoices += 1;
      if ((visits[choice.destinationId] ?? 0) >= maxVisitsPerPassage) {
        truncationReasons.add("maxVisitsPerPassage");
        const loopPath = [...path, choice.destinationId];
        loops.push({ passageId: choice.destinationId, passageIds: loopPath });
        paths.push({
          passageIds: loopPath,
          finalState: applyEffects(state, choice.effects),
          terminatedBy: "loop",
        });
        continue;
      }
      queue.push({
        passageId: choice.destinationId,
        state: applyEffects(state, choice.effects),
        path,
        visits,
      });
    }
    if (availableChoices === 0) {
      paths.push({ passageIds: path, finalState: state, terminatedBy: "dead-end" });
    }
  }

  const endingIds = project.passages
    .filter((passage) => passage.ending || passage.endingClassification)
    .map((passage) => passage.id as string);
  const lengths = paths.map((path) => path.passageIds.length);
  const impossibleChoices = [...choiceAttempts.entries()]
    .filter(([, attempts]) => attempts.met === 0 && attempts.unmet > 0)
    .map(([key]) => {
      const [passageId, choiceId] = key.split("\0");
      return { passageId, choiceId };
    })
    .sort((left, right) => `${left.passageId}:${left.choiceId}`.localeCompare(`${right.passageId}:${right.choiceId}`));

  return {
    reachableEndingIds: [...reachableEndings].sort(),
    unreachableEndingIds: endingIds.filter((id) => !reachableEndings.has(id)).sort(),
    paths,
    loops,
    impossibleChoices,
    pathLengths: {
      min: lengths.length ? Math.min(...lengths) : 0,
      max: lengths.length ? Math.max(...lengths) : 0,
      average: lengths.length ? lengths.reduce((total, length) => total + length, 0) / lengths.length : 0,
    },
    statRanges,
    relationshipRanges,
    exploredStates: seen.size,
    equivalentStatesCollapsed,
    exhaustive: truncationReasons.size === 0,
    truncated: truncationReasons.size > 0,
    truncationReasons: [...truncationReasons].sort(),
  };
}
