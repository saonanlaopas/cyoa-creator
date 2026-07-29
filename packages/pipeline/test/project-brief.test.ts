import { describe, expect, it } from "vitest";
import { defaultProjectBrief, ProjectBriefSchema } from "../src/index.js";

describe("ProjectBriefSchema", () => {
  it("uses the agreed long-form planning defaults", () => {
    expect(defaultProjectBrief("A Long Story")).toMatchObject({
      workingTitle: "A Long Story",
      totalWordTarget: 175_000,
      typicalPlaythroughWordTarget: 50_000,
      routeTarget: 5,
      endingTarget: 10,
      passageWordTarget: 500,
      branchingStyle: "braided",
    });
  });

  it("supports larger projects but rejects an impossible playthrough budget", () => {
    expect(ProjectBriefSchema.parse({
      ...defaultProjectBrief(),
      totalWordTarget: 400_000,
      typicalPlaythroughWordTarget: 100_000,
    }).totalWordTarget).toBe(400_000);
    expect(() => ProjectBriefSchema.parse({
      ...defaultProjectBrief(),
      totalWordTarget: 150_000,
      typicalPlaythroughWordTarget: 150_000,
    })).toThrow("Typical playthrough target must be smaller");
  });
});
