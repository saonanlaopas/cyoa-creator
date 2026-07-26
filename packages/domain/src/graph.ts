import type { Condition } from "./mechanics.js";
import type { Project } from "./project.js";

export type GraphFindingSeverity = "error" | "warning" | "info";

export interface GraphFinding {
  code: "missing_start" | "duplicate_passage" | "missing_destination" |
    "unreachable_passage" | "unreachable_ending" | "no_reachable_ending" |
    "variable_read_before_initialization";
  severity: GraphFindingSeverity;
  passageId?: string;
  choiceId?: string;
  detail?: string;
}

function conditionVariable(condition: Condition): string | undefined {
  if (condition.kind === "statAtLeast") return `stat:${condition.key}`;
  if (condition.kind === "flagEquals") return `flag:${condition.key}`;
  if (condition.kind === "relationshipAtLeast") return `relationship:${condition.key}`;
  return undefined;
}

export function validateGraph(project: Project): GraphFinding[] {
  const findings: GraphFinding[] = [];
  const byId = new Map<string, Project["passages"][number]>();
  for (const passage of project.passages) {
    if (byId.has(passage.id)) {
      findings.push({ code: "duplicate_passage", severity: "error", passageId: passage.id });
    } else byId.set(passage.id, passage);
  }
  if (!byId.has(project.startPassageId)) {
    findings.push({ code: "missing_start", severity: "error", passageId: project.startPassageId });
  }

  for (const passage of project.passages) {
    for (const choice of passage.choices) {
      if (!byId.has(choice.destinationId)) {
        findings.push({
          code: "missing_destination", severity: "error", passageId: passage.id,
          choiceId: choice.id, detail: choice.destinationId,
        });
      }
      for (const condition of choice.conditions) {
        const variable = conditionVariable(condition);
        if (!variable) continue;
        const [kind, key] = variable.split(":");
        const initialized =
          (kind === "stat" && key in project.mechanics.visibleStats) ||
          (kind === "flag" && key in project.mechanics.hiddenFlags) ||
          (kind === "relationship" && key in project.mechanics.relationships);
        if (!initialized) {
          findings.push({
            code: "variable_read_before_initialization", severity: "warning",
            passageId: passage.id, choiceId: choice.id, detail: variable,
          });
        }
      }
    }
  }

  const reachable = new Set<string>();
  const queue = byId.has(project.startPassageId) ? [project.startPassageId as string] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const choice of byId.get(id)?.choices ?? []) {
      if (byId.has(choice.destinationId) && !reachable.has(choice.destinationId)) queue.push(choice.destinationId);
    }
  }
  let reachableEndings = 0;
  for (const passage of project.passages) {
    if (!reachable.has(passage.id)) {
      findings.push({
        code: passage.ending || passage.endingClassification ? "unreachable_ending" : "unreachable_passage",
        severity: "warning", passageId: passage.id,
      });
    } else if (passage.ending || passage.endingClassification) reachableEndings += 1;
  }
  if (reachableEndings === 0) findings.push({ code: "no_reachable_ending", severity: "error" });
  return findings;
}
