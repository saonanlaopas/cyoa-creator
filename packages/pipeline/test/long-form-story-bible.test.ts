import { describe, expect, it } from "vitest";
import { defaultLongFormStoryBible, LongFormStoryBibleSchema } from "../src/index.js";

describe("LongFormStoryBibleSchema", () => {
  it("creates a stable editable bible seed from an approved brief", () => {
    const bible = defaultLongFormStoryBible({
      title: "The Long Road",
      overview: "A student enters an impossible course.",
      protagonist: "Mara",
      pointOfView: "second-person",
      tone: "Academic horror",
    });
    expect(bible).toMatchObject({
      title: "The Long Road story bible",
      overview: "A student enters an impossible course.",
      characters: [{ id: "character-protagonist", name: "Mara", role: "Protagonist" }],
      proseGuidance: { pointOfView: "second-person", tone: ["Academic horror"] },
    });
  });

  it("requires stable IDs and at least two participants in a relationship", () => {
    const base = defaultLongFormStoryBible({ title: "Invalid" });
    expect(() => LongFormStoryBibleSchema.parse({
      ...base,
      characters: [{ id: "", name: "Mara" }],
    })).toThrow();
    expect(() => LongFormStoryBibleSchema.parse({
      ...base,
      characters: [
        { id: "mara", name: "Mara" },
        { id: "ivo", name: "Ivo" },
      ],
      relationships: [{
        id: "relationship-one",
        characterIds: ["mara", "missing"],
        label: "Alone",
        currentState: "",
        plannedArc: "",
      }],
    })).toThrow("Relationship participants must reference characters");
  });
});
