import { describe, expect, it } from "vitest";
import {
  defaultLongFormEndingPlan,
  defaultLongFormRoutePlan,
  defaultProjectBrief,
  LongFormEndingPlanSchema,
} from "../src/index.js";

describe("long-form ending plan", () => {
  it("promotes every route hook into a budgeted detailed ending", () => {
    const routes = defaultLongFormRoutePlan(defaultProjectBrief("The Long Road"));
    const plan = defaultLongFormEndingPlan(routes);
    expect(plan.endings).toHaveLength(routes.endingHooks.length);
    expect(plan.endings.reduce((total, ending) => total + ending.wordTarget, 0)).toBe(plan.endingWordTarget);
    expect(new Set(plan.endings.map((ending) => ending.hookId)).size).toBe(routes.endingHooks.length);
  });

  it("rejects duplicate hook mappings and unstable IDs", () => {
    const plan = defaultLongFormEndingPlan(defaultLongFormRoutePlan(defaultProjectBrief("Broken")));
    expect(() => LongFormEndingPlanSchema.parse({
      ...plan,
      endings: [
        plan.endings[0],
        { ...plan.endings[1], id: plan.endings[0]!.id, hookId: plan.endings[0]!.hookId },
      ],
    })).toThrow();
  });
});
