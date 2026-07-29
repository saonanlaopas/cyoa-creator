import { describe, expect, it } from "vitest";
import {
  defaultLongFormRoutePlan,
  defaultProjectBrief,
  LongFormRoutePlanSchema,
} from "../src/index.js";

describe("long-form route plan", () => {
  it("creates a fully budgeted route architecture from the approved brief", () => {
    const brief = { ...defaultProjectBrief("The Long Road"), totalWordTarget: 190_000, routeTarget: 5, endingTarget: 10 };
    const plan = defaultLongFormRoutePlan(brief);
    expect(plan.routes).toHaveLength(5);
    expect(plan.endingHooks).toHaveLength(10);
    expect(plan.acts.reduce((total, act) => total + act.wordTarget, 0)).toBe(190_000);
    expect(plan.acts.filter((act) => act.routeId === null)).toHaveLength(2);
    expect(plan.decisionPoints[0]?.choices).toHaveLength(5);
  });

  it("rejects broken route, act, and ending references", () => {
    const plan = defaultLongFormRoutePlan(defaultProjectBrief("Broken"));
    expect(() => LongFormRoutePlanSchema.parse({
      ...plan,
      acts: [{ ...plan.acts[0], routeId: "missing-route" }],
      routes: [{ ...plan.routes[0], endingHookIds: ["missing-ending"] }],
    })).toThrow();
  });
});
