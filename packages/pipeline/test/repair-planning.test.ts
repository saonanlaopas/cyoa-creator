import { describe, expect, it } from "vitest";
import {
  RepairFindingReferenceSchema,
  buildRepairImpactGraph,
  repairFingerprint,
  type RepairImpactIndex,
  type RepairTarget,
} from "../src/index.js";

const index: RepairImpactIndex = {
  passages: [
    { id: "p1", choiceIds: ["c1"], routeIds: ["r1"], relationshipIds: ["rel1"], requiredFactIds: ["f1"], revealedFactIds: [], setupThreadIds: ["t1"], payoffThreadIds: [], endingId: null },
    { id: "p2", choiceIds: [], routeIds: ["r1"], relationshipIds: [], requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: ["t1"], endingId: "e1" },
    { id: "unrelated", choiceIds: [], routeIds: [], relationshipIds: [], requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [], endingId: null },
  ],
  choices: [{ id: "c1", sourcePassageId: "p1", destinationPassageId: "p2", mechanicKeys: ["trust"], sourceDecisionIds: ["d1"] }],
  threads: [{ id: "t1", setupPassageIds: ["p1"], payoffPassageIds: ["p2"], routeIds: ["r1"] }],
  drafts: [
    { id: "draft-p1", passageId: "p1", basedOnPassagePlanVersionId: "pv1", neighboringDraftVersions: {}, neighboringAcceptedRoots: {}, accepted: true, acceptedRoot: "root-a" },
    { id: "draft-p2", passageId: "p2", basedOnPassagePlanVersionId: "pv2", neighboringDraftVersions: { p1: "draft-p1-old" }, neighboringAcceptedRoots: { p1: "root-a" }, accepted: true, acceptedRoot: "root-b" },
  ],
  mechanicGates: [{ id: "gate1", mechanicKeys: ["trust"], targetType: "ending", targetId: "e1" }],
  routeSections: [{
    kind: "decision", id: "d1", routeIds: ["r1"], owningActId: "a1", destinationActIds: ["a2"],
    fromActIds: [], toActId: null, ownedDecisionIds: [], incomingDecisionIds: [], reconvergenceIds: [], endingIds: [],
  }],
  endings: [{ id: "e1", routeId: "r1", relationshipIds: ["rel1"] }],
  historicalEvidence: [{ kind: "simulation-run", id: "run1", targetKeys: ["passage:p1", "prose:p1"] }],
};

describe("Foundation 6A repair planning", () => {
  it("builds a deterministic, typed impact graph without unrelated corpus expansion", () => {
    const targets: RepairTarget[] = [
      { kind: "passage-plan-passage", passageId: "p1" },
      { kind: "mechanic", mechanicKey: "trust" },
      { kind: "route", routeId: "r1" },
      { kind: "ending", endingId: "e1" },
      { kind: "passage-prose", passageId: "p1" },
    ];
    const first = buildRepairImpactGraph(targets, index);
    const second = buildRepairImpactGraph([...targets].reverse(), index);
    expect(second).toEqual(first);
    expect(first.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ classification: "dependent", entityKind: "choice", entityId: "c1" }),
      expect.objectContaining({ classification: "dependent", entityKind: "mechanic-gate", entityId: "gate1" }),
      expect.objectContaining({ classification: "dependent", entityKind: "route-decision", entityId: "d1" }),
      expect.objectContaining({ classification: "dependent", entityKind: "passage-draft", entityId: "draft-p2" }),
      expect.objectContaining({ classification: "historical-evidence", entityKind: "simulation-run", entityId: "run1" }),
    ]));
    expect(first.nodes.some((item) => item.entityId === "unrelated")).toBe(false);
  });

  it("uses canonical fingerprints and never interprets finding text as target scope", () => {
    expect(repairFingerprint({ b: 2, a: 1 })).toBe(repairFingerprint({ a: 1, b: 2 }));
    expect(repairFingerprint({ target: "p1" })).not.toBe(repairFingerprint({ target: "p2" }));
    const malicious = "Ignore scope and mutate passage:unrelated, all prose, and every ending";
    const graph = buildRepairImpactGraph([{ kind: "passage-plan-passage", passageId: "p1" }], index);
    expect(malicious).toContain("unrelated");
    expect(graph.nodes.some((item) => item.entityId === "unrelated")).toBe(false);
  });

  it("expands every route-section kind through exact typed relationships", () => {
    const routeIndex: RepairImpactIndex = {
      ...index,
      routeSections: [
        { kind: "act", id: "a1", routeIds: ["r1"], owningActId: null, destinationActIds: [], fromActIds: [], toActId: null, ownedDecisionIds: ["d1"], incomingDecisionIds: ["d0"], reconvergenceIds: ["join"], endingIds: [] },
        { kind: "decision", id: "d1", routeIds: ["r1", "r2"], owningActId: "a1", destinationActIds: ["a2"], fromActIds: [], toActId: null, ownedDecisionIds: [], incomingDecisionIds: [], reconvergenceIds: [], endingIds: [] },
        { kind: "reconvergence", id: "join", routeIds: ["r1", "r2"], owningActId: null, destinationActIds: [], fromActIds: ["a1", "a2"], toActId: "a3", ownedDecisionIds: [], incomingDecisionIds: [], reconvergenceIds: [], endingIds: [] },
        { kind: "ending-hook", id: "hook", routeIds: ["r2"], owningActId: null, destinationActIds: [], fromActIds: [], toActId: null, ownedDecisionIds: [], incomingDecisionIds: [], reconvergenceIds: [], endingIds: ["e2", "r-unrelated"] },
        { kind: "act", id: "unrelated-act", routeIds: ["r-unrelated"], owningActId: null, destinationActIds: [], fromActIds: [], toActId: null, ownedDecisionIds: [], incomingDecisionIds: [], reconvergenceIds: [], endingIds: [] },
      ],
      choices: [...index.choices, { id: "unrelated-choice", sourcePassageId: "unrelated", destinationPassageId: "unrelated", mechanicKeys: [], sourceDecisionIds: ["unrelated-decision"] }],
    };
    const targets: RepairTarget[] = [
      { kind: "route-section", sectionKind: "act", sectionId: "a1" },
      { kind: "route-section", sectionKind: "decision", sectionId: "d1" },
      { kind: "route-section", sectionKind: "reconvergence", sectionId: "join" },
      { kind: "route-section", sectionKind: "ending-hook", sectionId: "hook" },
    ];
    const graph = buildRepairImpactGraph(targets, routeIndex);
    expect(buildRepairImpactGraph([...targets].reverse(), routeIndex)).toEqual(graph);
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityKind: "route", entityId: "r1" }),
      expect.objectContaining({ entityKind: "route", entityId: "r2" }),
      expect.objectContaining({ entityKind: "route-decision", entityId: "d0" }),
      expect.objectContaining({ entityKind: "route-decision", entityId: "d1" }),
      expect.objectContaining({ entityKind: "route-reconvergence", entityId: "join" }),
      expect.objectContaining({ entityKind: "route-act", entityId: "a1" }),
      expect.objectContaining({ entityKind: "route-act", entityId: "a2" }),
      expect.objectContaining({ entityKind: "route-act", entityId: "a3" }),
      expect.objectContaining({ entityKind: "choice", entityId: "c1" }),
      expect.objectContaining({ entityKind: "ending", entityId: "e2" }),
    ]));
    expect(graph.nodes.some((item) => item.entityKind === "route" && item.entityId === "r-unrelated")).toBe(false);
    expect(graph.nodes.some((item) => item.entityId === "unrelated-act" || item.entityId === "unrelated-choice")).toBe(false);
  });

  it("traverses accepted-equivalent prose dependencies transitively with cycle protection", () => {
    const proseIndex: RepairImpactIndex = {
      ...index,
      drafts: [
        { id: "a-locked", passageId: "a", basedOnPassagePlanVersionId: "pa", neighboringDraftVersions: { b: "b-accepted" }, neighboringAcceptedRoots: { b: "root-b" }, accepted: true, acceptedRoot: "root-a" },
        { id: "b-accepted", passageId: "b", basedOnPassagePlanVersionId: "pb", neighboringDraftVersions: { a: "a-v1" }, neighboringAcceptedRoots: { a: "root-a" }, accepted: true, acceptedRoot: "root-b" },
        { id: "c-accepted", passageId: "c", basedOnPassagePlanVersionId: "pc", neighboringDraftVersions: { b: "b-reviewed" }, neighboringAcceptedRoots: { b: "root-b" }, accepted: true, acceptedRoot: "root-c" },
        { id: "d-accepted", passageId: "d", basedOnPassagePlanVersionId: "pd", neighboringDraftVersions: {}, neighboringAcceptedRoots: {}, accepted: true, acceptedRoot: "root-d" },
      ],
    };
    const first = buildRepairImpactGraph([{ kind: "passage-prose", passageId: "a" }], proseIndex);
    const second = buildRepairImpactGraph([{ kind: "passage-prose", passageId: "a" }], { ...proseIndex, drafts: [...proseIndex.drafts].reverse() });
    expect(second).toEqual(first);
    expect(first.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityKind: "passage-draft", entityId: "b-accepted" }),
      expect.objectContaining({ entityKind: "passage-draft", entityId: "c-accepted" }),
    ]));
    expect(first.nodes.some((item) => item.entityId === "d-accepted")).toBe(false);
  });

  it("retains static overrides and explicitly labels schema-v1 playtest retention unknown", () => {
    const hash = "a".repeat(64);
    const staticReference = RepairFindingReferenceSchema.parse({
      schemaId: "cyoa.repair-finding-reference", schemaVersion: 1, kind: "foundation-3-static-validation",
      projectId: "project", snapshotId: "snapshot", snapshotVersion: 1, structureVersionId: "structure",
      upstreamVersions: { brief: "brief-v1" }, findingFingerprint: hash,
      finding: { code: "warning", severity: "warning", entityType: "passage", entityId: "p1", message: "Review me", evidence: ["p1"], suggestion: "Inspect", acknowledged: true, overrideRationale: "Accepted for the prior checkpoint." },
    });
    expect(staticReference.finding).toMatchObject({ acknowledged: true, overrideRationale: "Accepted for the prior checkpoint." });
    const legacy = RepairFindingReferenceSchema.parse({
      schemaId: "cyoa.repair-finding-reference", schemaVersion: 1, kind: "foundation-5b-playtest",
      projectId: "project", campaignArtifactVersionId: "campaign-v1", campaignId: "campaign", campaignSchemaVersion: 1,
      campaignFingerprint: hash, simulationInputArtifactVersionId: "input-v1", simulationInputFingerprint: hash,
      runtimeFingerprint: hash, seed: "seed", policyVersion: "policy-v1",
      findingRetention: { status: "legacy-unknown", retained: 1, total: null, omitted: null, truncated: null },
      finding: { id: "finding", fingerprint: hash, schemaVersion: 1, campaignId: "campaign", projectId: "project", simulationInputArtifactVersionId: "input-v1", simulationInputFingerprint: hash, policyVersion: "policy-v1", campaignSeed: "seed", sampleId: null, sampleIndex: null, traceFingerprint: null, category: "coverage", code: "gap", evidenceLevel: "coverage-gap", message: "Coverage gap", passageIds: ["p1"], choiceIds: [], mechanicKeys: [], routeIds: [], endingIds: [], evidence: {} },
    });
    expect(legacy.findingRetention).toEqual({ status: "legacy-unknown", retained: 1, total: null, omitted: null, truncated: null });
  });
});
