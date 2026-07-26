import { describe, expect, it } from "vitest";
import { applyEffects, relationshipLabel, validateGraph, type Project, type StoryState } from "../src/index.js";

const mechanics = {
  visibleStats: { resolve: { label: "Resolve", initial: 0 } },
  relationships: { mara: { label: "Mara", initial: 0, bands: [{ min: 0, label: "Wary" }, { min: 2, label: "Trusting" }] } },
  hiddenFlags: { ready: false },
  inventory: [],
  protagonistTendencies: [],
  divergenceMode: "balanced" as const,
  randomness: false,
};

describe("domain behavior", () => {
  it("finds broken destinations and accepts a valid route", () => {
    const project = {
      id: "p", name: "Story", schemaVersion: 1, startPassageId: "start", mechanics, metadata: {},
      passages: [
        { id: "start", title: "Start", purpose: "", prose: "", participants: [], requiredKnowledge: [], incomingAssumptions: [], ending: null, choices: [{ id: "go", label: "Go", destinationId: "missing", conditions: [], effects: [], hardGate: false }] },
      ],
    } as Project;
    expect(validateGraph(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_destination", passageId: "start" }),
    ]));
    project.passages.push({ id: "missing", title: "End", purpose: "", prose: "", participants: [], requiredKnowledge: [], incomingAssumptions: [], ending: "success", choices: [] });
    expect(validateGraph(project)).toEqual([]);
  });

  it("applies immediate and delayed state while deriving relationship labels", () => {
    const empty: StoryState = { stats: {}, relationships: {}, flags: {}, inventory: [], pendingEffects: [] };
    const scheduled = applyEffects(empty, [
      { op: "addStat", key: "resolve", value: 1 },
      { op: "setFlag", key: "ready", value: true, delay: "nextPassage" },
      { op: "addRelationship", key: "mara", value: 2 },
    ]);
    expect(scheduled).toMatchObject({ stats: { resolve: 1 }, flags: {}, relationships: { mara: 2 } });
    expect(applyEffects(scheduled, [])).toMatchObject({ flags: { ready: true } });
    expect(relationshipLabel(mechanics, "mara", 2)).toBe("Trusting");
  });
});
