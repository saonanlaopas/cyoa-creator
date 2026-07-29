import { describe, expect, it } from "vitest";
import {
  applyPlanningOperations,
  buildLongFormProjectReferenceIndex,
  defaultLongFormEndingPlan,
  defaultLongFormRoutePlan,
  defaultLongFormStoryBible,
  defaultProjectBrief,
  enrichOperationGroups,
  planningSection,
  validateLongFormProject,
} from "../src/index.js";

describe("long-form production foundation", () => {
  it("finds broken references with stable codes and entity IDs", () => {
    const brief = defaultProjectBrief("Reference test");
    const bible = defaultLongFormStoryBible({ title: "Reference test" });
    const routes = defaultLongFormRoutePlan(brief);
    routes.routes[0]!.relationshipArcs.push({ relationshipId: "missing-relationship", trajectory: "Impossible" });
    const endings = defaultLongFormEndingPlan(routes);
    endings.endings[0]!.hookId = "missing-hook";

    expect(validateLongFormProject({ brief, bible, routes, endings, mechanics: null })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "route.relationship.unknown", severity: "error", entityId: routes.routes[0]!.id }),
      expect.objectContaining({ code: "ending.hook.unknown", severity: "error", entityId: endings.endings[0]!.id }),
    ]));
  });

  it("scopes an entity without including unrelated siblings", () => {
    const routes = defaultLongFormRoutePlan(defaultProjectBrief("Scope test"));
    const selected = planningSection(routes, routes.routes[0]!.id);
    expect(selected.content).toEqual(routes.routes[0]);
    expect(JSON.stringify(selected.content)).not.toContain(routes.routes[1]!.id);
  });

  it("indexes stable records across planning artifacts", () => {
    const brief = defaultProjectBrief("Index test");
    const bible = defaultLongFormStoryBible({ title: "Index test" });
    const routes = defaultLongFormRoutePlan(brief);
    const index = buildLongFormProjectReferenceIndex({ brief, bible, routes, endings: null, mechanics: null });
    expect(index.byId.get(routes.routes[0]!.id)).toEqual([
      expect.objectContaining({ artifactId: "routes", entityId: routes.routes[0]!.id }),
    ]);
  });

  it("uses stable IDs and fingerprints to reject stale entity operations", () => {
    const brief = defaultProjectBrief("Operation test");
    const groups = enrichOperationGroups(brief, [{
      id: "word-budget",
      label: "Word budget",
      summary: "Increase the word target.",
      dependsOnGroupIds: [],
      safeToApplyIndependently: true,
      operations: [{ kind: "set-fields", targetId: "root", changes: { totalWordTarget: 180_000 } }],
    }]);
    expect(applyPlanningOperations(brief, groups)).toMatchObject({ totalWordTarget: 180_000 });
    expect(() => applyPlanningOperations({ ...brief, premise: "Newer work" }, groups)).toThrow("PROPOSAL_ENTITY_STALE");
  });
});
