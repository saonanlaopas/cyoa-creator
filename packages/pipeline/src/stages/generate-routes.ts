import { validateGraph, type Project } from "@story-to-cyoa/domain";
import type { AdaptationPlan } from "../schemas/adaptation-plan.js";

export function generateRouteGraph(
  projectId: string,
  plan: AdaptationPlan,
): { graph: Project; findings: ReturnType<typeof validateGraph> } {
  const graph: Project = {
    id: projectId as Project["id"],
    name: "Generated routes",
    schemaVersion: 1,
    startPassageId: "start" as Project["startPassageId"],
    metadata: {},
    mechanics: {
      visibleStats: Object.fromEntries(
        plan.visibleStats.map((stat) => [stat.key, { label: stat.label, initial: 0 }]),
      ),
      relationships: Object.fromEntries(
        plan.relationships.map((relationship) => [
          relationship.key,
          { label: relationship.label, initial: 0, bands: [] },
        ]),
      ),
      hiddenFlags: {},
      inventory: [],
      protagonistTendencies: [],
      divergenceMode: plan.divergenceMode,
      randomness: false,
    },
    passages: [
      {
        id: "start" as never,
        title: "Opening choice",
        purpose: "establish agency",
        prose: "",
        participants: [],
        requiredKnowledge: [],
        incomingAssumptions: [],
        choices: [
          {
            id: "continue" as never,
            label: "Continue",
            destinationId: "ending" as never,
            conditions: [],
            effects: [],
            hardGate: false,
          },
        ],
      },
      {
        id: "ending" as never,
        title: "First ending",
        purpose: "resolve opening",
        prose: "",
        participants: [],
        requiredKnowledge: [],
        incomingAssumptions: [],
        choices: [],
        ending: "partial",
      },
    ],
  };

  return { graph, findings: validateGraph(graph) };
}
