import { describe, expect, it } from "vitest";
import {
  defaultLongFormEndingPlan, defaultLongFormMechanicsPlan, defaultLongFormRoutePlan,
  defaultLongFormStoryBible, defaultProjectBrief, LongFormMechanicsPlanSchema,
} from "../src/index.js";

describe("long-form mechanics plan", () => {
  it("seeds candidate stats and story-bible relationships without pretending they are influential", () => {
    const brief = defaultProjectBrief("Mechanics");
    const endings = defaultLongFormEndingPlan(defaultLongFormRoutePlan(brief));
    const bible = defaultLongFormStoryBible({ title: brief.workingTitle });
    const plan = defaultLongFormMechanicsPlan(bible, endings);
    expect(plan.visibleStats).toHaveLength(3);
    expect(plan.gates).toEqual([]);
    expect(plan.balancingRules.map((rule) => rule.id)).toContain("rule-no-grinding");
  });

  it("rejects duplicate and unknown mechanic keys", () => {
    const brief = defaultProjectBrief("Broken");
    const plan = defaultLongFormMechanicsPlan(
      defaultLongFormStoryBible({ title: brief.workingTitle }),
      defaultLongFormEndingPlan(defaultLongFormRoutePlan(brief)),
    );
    expect(() => LongFormMechanicsPlanSchema.parse({
      ...plan,
      flags: [{ id: "flag", key: "resolve", label: "Duplicate", meaning: "" }],
    })).toThrow();
  });
});
