import { createHash } from "node:crypto";
import type { ProjectBrief } from "./schemas/project-brief.js";
import type { LongFormStoryBible } from "./schemas/long-form-story-bible.js";
import type { LongFormRoutePlan } from "./schemas/long-form-route-plan.js";
import type { LongFormEndingPlan } from "./schemas/long-form-ending-plan.js";
import type { LongFormMechanicsPlan } from "./schemas/long-form-mechanics-plan.js";

export const planningArtifactIds = ["brief", "bible", "routes", "endings", "mechanics"] as const;
export type PlanningArtifactId = typeof planningArtifactIds[number];
export type PlanningArtifact =
  | ProjectBrief
  | LongFormStoryBible
  | LongFormRoutePlan
  | LongFormEndingPlan
  | LongFormMechanicsPlan;

export interface LongFormProjectSnapshot {
  brief: ProjectBrief | null;
  bible: LongFormStoryBible | null;
  routes: LongFormRoutePlan | null;
  endings: LongFormEndingPlan | null;
  mechanics: LongFormMechanicsPlan | null;
}

export type FindingSeverity = "error" | "warning" | "info";
export interface PlanningFinding {
  code: string;
  severity: FindingSeverity;
  artifactId: PlanningArtifactId;
  entityId?: string;
  path?: string;
  message: string;
  suggestion?: string;
}

export interface ProposedPlanningOperation {
  kind: "set-fields" | "add-item" | "remove-item" | "reorder-items";
  targetId: string;
  collection?: string;
  changes?: Record<string, unknown>;
  item?: Record<string, unknown>;
  orderedIds?: string[];
}

export interface PlanningOperation extends ProposedPlanningOperation {
  id: string;
  baseFingerprint: string;
}

export interface ProposedOperationGroup {
  id: string;
  label: string;
  summary: string;
  dependsOnGroupIds: string[];
  safeToApplyIndependently: boolean;
  operations: ProposedPlanningOperation[];
}

export interface PlanningOperationGroup extends Omit<ProposedOperationGroup, "operations"> {
  operations: PlanningOperation[];
}

export interface PlanningProposal {
  groups: PlanningOperationGroup[];
}

export interface IndexedProjectRecord {
  artifactId: PlanningArtifactId;
  entityId: string;
  value: Record<string, unknown>;
}

export interface LongFormProjectReferenceIndex {
  byId: Map<string, IndexedProjectRecord[]>;
  byArtifact: Map<PlanningArtifactId, IndexedProjectRecord[]>;
}

export function buildLongFormProjectReferenceIndex(
  snapshot: LongFormProjectSnapshot,
): LongFormProjectReferenceIndex {
  const byId = new Map<string, IndexedProjectRecord[]>();
  const byArtifact = new Map<PlanningArtifactId, IndexedProjectRecord[]>();
  const visit = (artifactId: PlanningArtifactId, value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(artifactId, item));
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string") {
      const indexed = { artifactId, entityId: record.id, value: record };
      byId.set(record.id, [...(byId.get(record.id) ?? []), indexed]);
      byArtifact.set(artifactId, [...(byArtifact.get(artifactId) ?? []), indexed]);
    }
    Object.values(record).forEach((item) => visit(artifactId, item));
  };
  planningArtifactIds.forEach((artifactId) => visit(artifactId, snapshot[artifactId]));
  return { byId, byArtifact };
}

const addFinding = (
  findings: PlanningFinding[],
  finding: PlanningFinding,
): void => {
  if (!findings.some((item) =>
    item.code === finding.code
    && item.artifactId === finding.artifactId
    && item.entityId === finding.entityId
    && item.path === finding.path)) findings.push(finding);
};

export function validateLongFormProject(snapshot: LongFormProjectSnapshot): PlanningFinding[] {
  const findings: PlanningFinding[] = [];
  const bible = snapshot.bible;
  const routes = snapshot.routes;
  const endings = snapshot.endings;
  const mechanics = snapshot.mechanics;
  const characterIds = new Set(bible?.characters.map((item) => item.id) ?? []);
  const relationshipIds = new Set(bible?.relationships.map((item) => item.id) ?? []);
  const routeIds = new Set(routes?.routes.map((item) => item.id) ?? []);
  const hookById = new Map(routes?.endingHooks.map((item) => [item.id, item]) ?? []);
  const decisionIds = new Set(routes?.decisionPoints.flatMap((item) =>
    [item.id, ...item.choices.map((choice) => choice.id)]) ?? []);
  const endingIds = new Set(endings?.endings.map((item) => item.id) ?? []);

  routes?.routes.forEach((route, routeIndex) => {
    route.relationshipArcs.forEach((arc, arcIndex) => {
      if (!relationshipIds.has(arc.relationshipId)) addFinding(findings, {
        code: "route.relationship.unknown",
        severity: "error",
        artifactId: "routes",
        entityId: route.id,
        path: `routes.${routeIndex}.relationshipArcs.${arcIndex}.relationshipId`,
        message: `Route "${route.name}" references unknown relationship ${arc.relationshipId}.`,
        suggestion: "Choose a relationship from the approved story bible.",
      });
    });
    route.endingHookIds.forEach((hookId) => {
      const hook = hookById.get(hookId);
      if (hook && hook.routeId !== route.id) addFinding(findings, {
        code: "route.hook.owner-mismatch",
        severity: "error",
        artifactId: "routes",
        entityId: route.id,
        message: `Ending hook ${hookId} belongs to ${hook.routeId}, not ${route.id}.`,
        suggestion: "Move the hook reference to its owning route or change the hook owner.",
      });
    });
  });
  routes?.endingHooks.forEach((hook) => {
    const owner = routes.routes.find((route) => route.id === hook.routeId);
    if (!owner?.endingHookIds.includes(hook.id)) addFinding(findings, {
      code: "route.hook.missing-owner-link",
      severity: "error",
      artifactId: "routes",
      entityId: hook.id,
      message: `Ending hook "${hook.label}" is not listed by its owning route.`,
      suggestion: `Add ${hook.id} to route ${hook.routeId}.`,
    });
  });

  endings?.endings.forEach((ending, endingIndex) => {
    const hook = hookById.get(ending.hookId);
    if (!hook) addFinding(findings, {
      code: "ending.hook.unknown",
      severity: "error",
      artifactId: "endings",
      entityId: ending.id,
      path: `endings.${endingIndex}.hookId`,
      message: `Ending "${ending.title}" references unknown hook ${ending.hookId}.`,
    });
    if (!routeIds.has(ending.routeId)) addFinding(findings, {
      code: "ending.route.unknown",
      severity: "error",
      artifactId: "endings",
      entityId: ending.id,
      message: `Ending "${ending.title}" references unknown route ${ending.routeId}.`,
    });
    if (hook && hook.routeId !== ending.routeId) addFinding(findings, {
      code: "ending.hook.route-mismatch",
      severity: "error",
      artifactId: "endings",
      entityId: ending.id,
      message: `Ending "${ending.title}" and hook ${ending.hookId} disagree about route ownership.`,
    });
    ending.contributingDecisionIds.forEach((decisionId) => {
      if (!decisionIds.has(decisionId)) addFinding(findings, {
        code: "ending.decision.unknown",
        severity: "error",
        artifactId: "endings",
        entityId: ending.id,
        message: `Ending "${ending.title}" references unknown decision ${decisionId}.`,
      });
    });
    ending.characterOutcomes.forEach((outcome) => {
      if (!characterIds.has(outcome.characterId)) addFinding(findings, {
        code: "ending.character.unknown",
        severity: "error",
        artifactId: "endings",
        entityId: ending.id,
        message: `Ending "${ending.title}" references unknown character ${outcome.characterId}.`,
      });
    });
    ending.relationshipOutcomes.forEach((outcome) => {
      if (!relationshipIds.has(outcome.relationshipId)) addFinding(findings, {
        code: "ending.relationship.unknown",
        severity: "error",
        artifactId: "endings",
        entityId: ending.id,
        message: `Ending "${ending.title}" references unknown relationship ${outcome.relationshipId}.`,
      });
    });
    if (!ending.summary.trim() || !ending.thematicPayoff.trim()) addFinding(findings, {
      code: "ending.readiness.placeholder",
      severity: "warning",
      artifactId: "endings",
      entityId: ending.id,
      message: `Ending "${ending.title}" still lacks a complete summary or thematic payoff.`,
    });
  });

  if (routes && endings) {
    const coveredHooks = new Set(endings.endings.map((item) => item.hookId));
    routes.endingHooks.forEach((hook) => {
      if (!coveredHooks.has(hook.id)) addFinding(findings, {
        code: "ending.hook.uncovered",
        severity: "error",
        artifactId: "endings",
        entityId: hook.id,
        message: `Route ending hook "${hook.label}" has no detailed ending.`,
      });
    });
  }

  const mechanicKeys = new Set([
    ...(mechanics?.visibleStats.map((item) => item.key) ?? []),
    ...(mechanics?.relationships.map((item) => item.key) ?? []),
    ...(mechanics?.flags.map((item) => item.key) ?? []),
    ...(mechanics?.resources.map((item) => item.key) ?? []),
  ]);
  mechanics?.relationships.forEach((relationship) => {
    if (!relationshipIds.has(relationship.relationshipId)) addFinding(findings, {
      code: "mechanic.relationship.unknown",
      severity: "error",
      artifactId: "mechanics",
      entityId: relationship.id,
      message: `Mechanic "${relationship.label}" references unknown story-bible relationship ${relationship.relationshipId}.`,
    });
    const sorted = [...relationship.bands].sort((a, b) => a.minimum - b.minimum);
    if (sorted.some((band, index) => index > 0 && band.minimum === sorted[index - 1]?.minimum)) {
      addFinding(findings, {
        code: "mechanic.relationship-band.duplicate-threshold",
        severity: "error",
        artifactId: "mechanics",
        entityId: relationship.id,
        message: `Relationship mechanic "${relationship.label}" has duplicate band thresholds.`,
      });
    }
  });
  mechanics?.gates.forEach((gate) => {
    const targets = gate.targetType === "route" ? routeIds : endingIds;
    if (!targets.has(gate.targetId)) addFinding(findings, {
      code: "mechanic.gate.target-unknown",
      severity: "error",
      artifactId: "mechanics",
      entityId: gate.id,
      message: `Gate ${gate.id} references unknown ${gate.targetType} ${gate.targetId}.`,
    });
  });
  mechanics?.choiceEffectPlans.forEach((effect) => {
    effect.sourceDecisionIds.forEach((decisionId) => {
      if (!decisionIds.has(decisionId)) addFinding(findings, {
        code: "mechanic.effect.decision-unknown",
        severity: "error",
        artifactId: "mechanics",
        entityId: effect.id,
        message: `Effect plan "${effect.label}" references unknown decision ${decisionId}.`,
      });
    });
  });
  if (mechanics) {
    const used = new Set([
      ...mechanics.gates.flatMap((gate) => gate.conditions.map((condition) => condition.mechanicKey)),
      ...mechanics.choiceEffectPlans.flatMap((effect) => effect.mechanicKeys),
    ]);
    mechanicKeys.forEach((key) => {
      if (!used.has(key)) addFinding(findings, {
        code: "mechanic.unused",
        severity: "error",
        artifactId: "mechanics",
        entityId: key,
        message: `Mechanic ${key} does not influence a gate or choice-effect plan.`,
        suggestion: "Use it in a gate/effect plan or remove it.",
      });
    });
  }

  return findings.sort((a, b) =>
    a.severity.localeCompare(b.severity)
    || a.artifactId.localeCompare(b.artifactId)
    || a.code.localeCompare(b.code));
}

export function contentFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

type Located = { value: Record<string, unknown>; parentArray?: unknown[]; index?: number };
function locate(root: Record<string, unknown>, targetId: string): Located | undefined {
  if (targetId === "root") return { value: root };
  if (targetId.startsWith("section:")) {
    const key = targetId.slice("section:".length);
    const value = root[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return { value: value as Record<string, unknown> };
    }
    return undefined;
  }
  const visit = (value: unknown): Located | undefined => {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const child = value[index];
        if (child && typeof child === "object" && (child as { id?: unknown }).id === targetId) {
          return { value: child as Record<string, unknown>, parentArray: value, index };
        }
        const nested = visit(child);
        if (nested) return nested;
      }
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value as Record<string, unknown>)) {
        const nested = visit(child);
        if (nested) return nested;
      }
    }
    return undefined;
  };
  return visit(root);
}

export function planningSection(
  artifact: PlanningArtifact,
  sectionId?: string,
): { id: string; content: unknown } {
  if (!sectionId || sectionId === "root") return { id: "root", content: artifact };
  const located = locate(artifact as unknown as Record<string, unknown>, sectionId);
  if (!located) throw new Error("Planning section not found");
  return { id: sectionId, content: located.value };
}

export function enrichOperationGroups(
  artifact: PlanningArtifact,
  groups: ProposedOperationGroup[],
): PlanningOperationGroup[] {
  const root = artifact as unknown as Record<string, unknown>;
  return groups.map((group) => ({
    ...group,
    operations: group.operations.map((operation, index) => {
      const located = locate(root, operation.targetId);
      if (!located) throw new Error(`Proposal target not found: ${operation.targetId}`);
      return {
        ...operation,
        id: `${group.id}-operation-${index + 1}`,
        baseFingerprint: contentFingerprint(located.value),
      };
    }),
  }));
}

export function applyPlanningOperations(
  artifact: PlanningArtifact,
  groups: PlanningOperationGroup[],
): PlanningArtifact {
  const result = structuredClone(artifact) as unknown as Record<string, unknown>;
  const original = artifact as unknown as Record<string, unknown>;
  for (const group of groups) {
    for (const operation of group.operations) {
      const located = locate(original, operation.targetId);
      if (!located) throw new Error(`Proposal target not found: ${operation.targetId}`);
      if (contentFingerprint(located.value) !== operation.baseFingerprint) {
        throw new Error("PROPOSAL_ENTITY_STALE");
      }
    }
  }
  for (const group of groups) {
    for (const operation of group.operations) {
      const located = locate(result, operation.targetId);
      if (!located) throw new Error(`Proposal target not found: ${operation.targetId}`);
      if (operation.kind === "set-fields") {
        const changes = operation.changes ?? {};
        if ("id" in changes || "schemaVersion" in changes) throw new Error("Proposal cannot change stable identity");
        Object.assign(located.value, changes);
      } else if (operation.kind === "add-item") {
        const collection = operation.collection && located.value[operation.collection];
        if (!Array.isArray(collection) || !operation.item) throw new Error("Proposal collection not found");
        collection.push(operation.item);
      } else if (operation.kind === "remove-item") {
        if (!located.parentArray || located.index === undefined) throw new Error("Proposal cannot remove the artifact root");
        located.parentArray.splice(located.index, 1);
      } else {
        const collection = operation.collection && located.value[operation.collection];
        if (!Array.isArray(collection) || !operation.orderedIds) throw new Error("Proposal collection not found");
        const byId = new Map(collection.map((item) => [(item as { id?: string }).id, item]));
        if (byId.size !== operation.orderedIds.length || operation.orderedIds.some((id) => !byId.has(id))) {
          throw new Error("Reorder must contain every existing stable ID exactly once");
        }
        located.value[operation.collection!] = operation.orderedIds.map((id) => byId.get(id));
      }
    }
  }
  return result as unknown as PlanningArtifact;
}

export interface PlanningSectionOption {
  id: string;
  label: string;
}

export function listPlanningSections(
  artifactId: PlanningArtifactId,
  artifact: PlanningArtifact,
): PlanningSectionOption[] {
  const options: PlanningSectionOption[] = [{ id: "root", label: "Whole artifact" }];
  const root = artifact as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(root)) {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (!item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string") return;
        const record = item as Record<string, unknown>;
        const label = String(record.name ?? record.title ?? record.label ?? record.question ?? record.id);
        options.push({ id: String(record.id), label: `${key}: ${label}` });
      });
    } else if (value && typeof value === "object" && key !== "schemaVersion") {
      options.push({ id: `section:${key}`, label: key.replace(/([A-Z])/g, " $1").toLowerCase() });
    }
  }
  return options.map((option) => ({ ...option, label: `${artifactId} / ${option.label}` }));
}

export function summarizePlanningArtifact(artifactId: PlanningArtifactId, artifact: PlanningArtifact | null): unknown {
  if (!artifact) return null;
  if (artifactId === "brief") {
    const brief = artifact as ProjectBrief;
    return {
      workingTitle: brief.workingTitle,
      premise: brief.premise,
      totalWordTarget: brief.totalWordTarget,
      routeTarget: brief.routeTarget,
      endingTarget: brief.endingTarget,
      branchingStyle: brief.branchingStyle,
    };
  }
  const root = artifact as unknown as Record<string, unknown>;
  const summary: Record<string, unknown> = {
    title: root.title,
    overview: root.overview,
  };
  for (const [key, value] of Object.entries(root)) {
    if (Array.isArray(value)) summary[`${key}Count`] = value.length;
  }
  return summary;
}
