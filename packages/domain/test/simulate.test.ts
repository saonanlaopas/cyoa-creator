import { describe, expect, it } from "vitest";
import { simulateProject, type Project } from "../src/index.js";

function project(): Project {
  return {
    id: "project", name: "Routes", schemaVersion: 1, startPassageId: "start", metadata: {},
    mechanics: {
      visibleStats: { resolve: { label: "Resolve", initial: 0 } },
      relationships: {}, hiddenFlags: {}, inventory: [], protagonistTendencies: [],
      divergenceMode: "balanced", randomness: false,
    },
    passages: [
      {
        id: "start", title: "Start", purpose: "", prose: "", participants: [], requiredKnowledge: [],
        incomingAssumptions: [], ending: null,
        choices: [
          { id: "brave", label: "Be brave", destinationId: "end-good", conditions: [], effects: [{ op: "addStat", key: "resolve", value: 2 }], hardGate: false },
          { id: "wait", label: "Wait", destinationId: "end-bad", conditions: [], effects: [], hardGate: false },
          { id: "impossible", label: "Impossible", destinationId: "end-good", conditions: [{ kind: "statAtLeast", key: "resolve", value: 99 }], effects: [], hardGate: true },
        ],
      },
      { id: "end-good", title: "Good", purpose: "", prose: "", participants: [], requiredKnowledge: [], incomingAssumptions: [], ending: "success", choices: [] },
      { id: "end-bad", title: "Bad", purpose: "", prose: "", participants: [], requiredKnowledge: [], incomingAssumptions: [], ending: "failure", choices: [] },
      { id: "hidden-end", title: "Hidden", purpose: "", prose: "", participants: [], requiredKnowledge: [], incomingAssumptions: [], ending: "other", choices: [] },
    ],
  } as Project;
}

describe("simulateProject", () => {
  it("reports endings, impossible choices, lengths and state ranges", () => {
    const report = simulateProject(project());
    expect(report.reachableEndingIds).toEqual(["end-bad", "end-good"]);
    expect(report.unreachableEndingIds).toEqual(["hidden-end"]);
    expect(report.impossibleChoices).toContainEqual({ passageId: "start", choiceId: "impossible" });
    expect(report.statRanges.resolve).toEqual({ min: 0, max: 2 });
    expect(report.pathLengths).toMatchObject({ min: 2, max: 2, average: 2 });
    expect(report.exhaustive).toBe(true);
  });

  it("bounds loops and honestly marks truncation", () => {
    const looping = project();
    looping.passages[0].choices = [{
      id: "again", label: "Again", destinationId: "start", conditions: [], effects: [], hardGate: false,
    }];
    const report = simulateProject(looping, { maxVisitsPerPassage: 1 });
    expect(report.loops).toHaveLength(1);
    expect(report.truncated).toBe(true);
    expect(report.truncationReasons).toContain("maxVisitsPerPassage");
  });
});
