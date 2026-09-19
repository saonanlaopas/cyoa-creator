import { describe, expect, it } from "vitest";
import {
  normalizeCreativeDirection,
  selectCreativeDirectionContext,
  type RepairProposalBaseState,
} from "@story-to-cyoa/pipeline";
import { repairCreativeDirectionScope } from "../src/services/repair-proposal-service.js";
import type { RepairPlanView } from "../src/services/repair-planning-service.js";

const targetKeys = {
  relationship: "relationship:relationship-main",
  route: "route:route-main",
  act: "route-act:act-main",
  passage: "passage:passage-main",
} as const;

function fixture() {
  const base = {
    bible: { versionId: "bible-v1", content: {
      characters: [{ id: "character-a" }, { id: "character-b" }, { id: "character-unrelated" }],
      relationships: [
        { id: "relationship-main", characterIds: ["character-a", "character-b"] },
        { id: "relationship-unrelated", characterIds: ["character-a", "character-unrelated"] },
      ],
      canonFacts: [],
    } },
    routes: { versionId: "routes-v1", content: {
      routes: [
        { id: "route-main", relationshipArcs: [{ relationshipId: "relationship-main" }] },
        { id: "route-unrelated", relationshipArcs: [{ relationshipId: "relationship-unrelated" }] },
      ],
      acts: [
        { id: "act-main", routeId: "route-main" },
        { id: "act-unrelated", routeId: "route-unrelated" },
      ],
      decisionPoints: [], reconvergences: [], endingHooks: [],
    } },
    endings: { versionId: "endings-v1", content: { endings: [] } },
    mechanics: { versionId: "mechanics-v1", content: {} },
    structure: {},
    passages: [
      { versionId: "passage-main-v1", content: {
        id: "passage-main", routeIds: ["route-main"], characterIds: ["character-a"],
        relationshipIds: ["relationship-main"],
      } },
      { versionId: "passage-neighbor-v1", content: {
        id: "passage-neighbor", routeIds: ["route-main"], characterIds: ["character-b"], relationshipIds: [],
      } },
      { versionId: "passage-unrelated-v1", content: {
        id: "passage-unrelated", routeIds: ["route-unrelated"], characterIds: ["character-unrelated"],
        relationshipIds: ["relationship-unrelated"],
      } },
    ],
    choices: [{ versionId: "choice-main-v1", content: {
      id: "choice-main", sourcePassageId: "passage-main", destinationPassageId: "passage-neighbor",
    } }],
    threads: [],
  } as unknown as RepairProposalBaseState;
  const plan = { definition: { authorizedTargets: [
    { kind: "relationship", relationshipId: "relationship-main" },
    { kind: "route", routeId: "route-main" },
    { kind: "route-section", sectionKind: "act", sectionId: "act-main" },
    { kind: "passage-plan-passage", passageId: "passage-main" },
  ] } } as unknown as RepairPlanView;
  const direction = normalizeCreativeDirection({
    tone: {}, pacing: {}, prose: {}, fieldProvenance: [],
    relationshipPresentation: { profiles: [
      { id: "profile-main", relationshipKind: "friendship", relationshipId: "relationship-main", participantIds: [], developmentStyle: "gradual", emotionalTension: "moderate", melodrama: "low", mechanicsVisibility: "subtle", customGuidance: "", contentBoundaries: [] },
      { id: "profile-unrelated", relationshipKind: "rivalry", relationshipId: "relationship-unrelated", participantIds: [], developmentStyle: "volatile", emotionalTension: "high", melodrama: "low", mechanicsVisibility: "subtle", customGuidance: "", contentBoundaries: [] },
    ] },
    scopedVariations: [
      { id: "variation-route", scopeKind: "route", scopeId: "route-main", toneDescriptors: [], pacingGuidance: "", proseGuidance: "" },
      { id: "variation-act", scopeKind: "act", scopeId: "act-main", toneDescriptors: [], pacingGuidance: "", proseGuidance: "" },
      { id: "variation-unrelated", scopeKind: "route", scopeId: "route-unrelated", toneDescriptors: [], pacingGuidance: "", proseGuidance: "" },
    ],
  });
  return { base, plan, direction };
}

describe("repair proposal Creative Direction scope", () => {
  it("maps raw relationship, route, and act stable IDs instead of namespaced target keys", () => {
    const { base, plan, direction } = fixture();
    const relationship = repairCreativeDirectionScope(plan, base, [targetKeys.relationship]);
    expect(relationship).toEqual({
      routeIds: [], actIds: [], relationshipIds: ["relationship-main"],
      characterIds: ["character-a", "character-b"],
    });
    expect(selectCreativeDirectionContext(direction, relationship).context.relationshipPresentation?.profiles
      .map((item) => item.id)).toEqual(["profile-main"]);

    const route = repairCreativeDirectionScope(plan, base, [targetKeys.route]);
    expect(route).toMatchObject({ routeIds: ["route-main"], relationshipIds: ["relationship-main"] });
    expect(selectCreativeDirectionContext(direction, route).context.scopedVariations.map((item) => item.id))
      .toEqual(["variation-route"]);

    const act = repairCreativeDirectionScope(plan, base, [targetKeys.act]);
    expect(act).toMatchObject({ routeIds: ["route-main"], actIds: ["act-main"] });
    expect(selectCreativeDirectionContext(direction, act).context.scopedVariations.map((item) => item.id))
      .toEqual(["variation-act", "variation-route"]);
  });

  it("derives passage and connected-choice scope deterministically while omitting unrelated direction", () => {
    const { base, plan, direction } = fixture();
    const first = repairCreativeDirectionScope(plan, base, [targetKeys.passage]);
    const second = repairCreativeDirectionScope(plan, base, [targetKeys.passage]);
    expect(second).toEqual(first);
    expect(first).toEqual({
      routeIds: ["route-main"], actIds: [], relationshipIds: ["relationship-main"],
      characterIds: ["character-a", "character-b"],
    });
    const selected = selectCreativeDirectionContext(direction, first);
    expect(selected.context.relationshipPresentation?.profiles.map((item) => item.id)).toEqual(["profile-main"]);
    expect(selected.context.scopedVariations.map((item) => item.id)).toEqual(["variation-route"]);
    expect(JSON.stringify(selected.context)).not.toContain("unrelated");
  });
});
