import { describe, expect, it } from "vitest";
import type { Project } from "@story-to-cyoa/domain";
import { renderTwee } from "../src/index.js";

export function exportFixture(): Project {
  return {
    id: "export-project", name: "The <Last> Choice", schemaVersion: 1, startPassageId: "start", metadata: { apiKey: "must-not-export" },
    mechanics: {
      visibleStats: { resolve: { label: "Resolve", initial: 1 } },
      relationships: { mara: { label: "Mara", initial: 0, bands: [{ min: 0, label: "Wary" }, { min: 2, label: "Trusting" }] } },
      hiddenFlags: { secret: false }, inventory: [{ id: "key", label: "Brass key" }],
      protagonistTendencies: [], divergenceMode: "balanced", randomness: false,
    },
    passages: [
      { id: "start", title: "A [Door]", purpose: "", prose: "Never <<print $flags>> or [[inject]].", participants: [], requiredKnowledge: [], incomingAssumptions: [], ending: null, choices: [{ id: "open", label: "Open", destinationId: "end", conditions: [{ kind: "statAtLeast", key: "resolve", value: 1 }], effects: [{ op: "addItem", itemId: "key" }], hardGate: false }] },
      { id: "end", title: "A [Door]", purpose: "", prose: "Done.", participants: [], requiredKnowledge: [], incomingAssumptions: [], ending: "success", choices: [] },
    ],
  } as Project;
}

describe("renderTwee", () => {
  it("emits stable Twee 3 SugarCube with escaped prose and mechanics", () => {
    const first = renderTwee(exportFixture());
    expect(first).toContain(":: StoryData");
    expect(first).toContain("\"format\":\"SugarCube\"");
    expect(first).toContain(":: StoryInit");
    expect(first).toContain(":: A Door [passage]");
    expect(first).toContain(":: A Door (2) [passage ending]");
    expect(first).toContain("setup.storyToCyoA.conditions");
    expect(first).toContain("relationshipLabel");
    expect(first).toContain("&lt;&lt;print $flags&gt;&gt;");
    expect(first).not.toContain("must-not-export");
    expect(renderTwee(exportFixture())).toBe(first);
  });
});
