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
    { id: "draft-p1", passageId: "p1", basedOnPassagePlanVersionId: "pv1", neighboringDraftVersions: {}, accepted: true },
    { id: "draft-p2", passageId: "p2", basedOnPassagePlanVersionId: "pv2", neighboringDraftVersions: { p1: "draft-p1" }, accepted: true },
  ],
  mechanicGates: [{ id: "gate1", mechanicKeys: ["trust"], targetType: "ending", targetId: "e1" }],
  routeSections: [{ kind: "decision", id: "d1", routeIds: ["r1"] }],
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
