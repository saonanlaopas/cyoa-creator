import { describe, expect, it } from "vitest";
import type { RepairProposalRecord } from "@story-to-cyoa/domain";
import { selectGroups } from "../src/index.js";

function proposal(dependencies: Record<string, string[]> = { a: [], b: [], c: ["b"] }): RepairProposalRecord {
  const groupIds = Object.keys(dependencies).sort();
  return {
    groups: groupIds.map((id) => ({ id, operationIds: [`operation-${id}`], dependsOnGroupIds: dependencies[id] ?? [] })),
    operations: groupIds.map((id) => ({ id: `operation-${id}` })),
  } as unknown as RepairProposalRecord;
}

describe("Repair application group closure", () => {
  it("selects independent groups and computes deterministic dependency-first closure", () => {
    expect(selectGroups(proposal(), ["a"])).toEqual({
      explicitlySelectedGroupIds: ["a"], requiredDependencyGroupIds: [], effectiveGroupIds: ["a"], operationIds: ["operation-a"],
    });
    expect(selectGroups(proposal(), ["c"])).toEqual({
      explicitlySelectedGroupIds: ["c"], requiredDependencyGroupIds: ["b"], effectiveGroupIds: ["b", "c"],
      operationIds: ["operation-b", "operation-c"],
    });
    expect(selectGroups(proposal(), ["c", "a"])).toEqual(selectGroups(proposal(), ["a", "c"]));
    expect(selectGroups(proposal(), ["a", "c"]).effectiveGroupIds).toEqual(["a", "b", "c"]);
  });

  it("rejects unknown, duplicate, missing, and cyclic dependency selections", () => {
    expect(() => selectGroups(proposal(), [])).toThrow(/Select at least one/);
    expect(() => selectGroups(proposal(), ["a", "a"])).toThrow(/Duplicate/);
    expect(() => selectGroups(proposal(), ["unknown"])).toThrow(/Unknown/);
    expect(() => selectGroups(proposal({ a: ["missing"] }), ["a"])).toThrow(/missing/);
    expect(() => selectGroups(proposal({ a: ["b"], b: ["a"] }), ["a"])).toThrow(/cycle/);
  });
});
