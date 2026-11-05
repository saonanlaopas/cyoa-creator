import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AuthoringInstructionsSchema, AuthoringSettingsSchema, FictionCraftSnapshotSchema, authoringMessages, builtinFictionCraft, legacyAuthoringSettings, newProjectAuthoringSettings, sha256 } from "../src/index.js";
describe("versioned optional fiction craft", () => {
  it("packages exactly the canonical UTF-8 edition with a stable release hash", () => {
    const guide = builtinFictionCraft(); expect(guide.text).toBe(readFileSync(new URL('../../../docs/writing/FICTION_CRAFT.md', import.meta.url), 'utf8'));
    expect(Buffer.byteLength(guide.text)).toBe(8248); expect(guide.sha256).toBe('c42b4cd0239c26d1541615dd62ddc115281311d1f838e980468ca65631323e96');
    expect(() => FictionCraftSnapshotSchema.parse({ ...guide, text: guide.text+' ' })).toThrow();
    expect(() => FictionCraftSnapshotSchema.parse({ ...guide, version: "missing" })).toThrow();
  });
  it("defaults only new projects on, preserving legacy missing settings off", () => { expect(newProjectAuthoringSettings().enabled).toBe(true); expect(legacyAuthoringSettings()).toMatchObject({ enabled: false, guide: null }); expect(() => AuthoringSettingsSchema.parse({ ...legacyAuthoringSettings(), enabled: true })).toThrow(); });
  it.each([true,false])("delivers exact custom instructions and guide state %s without overwriting task contracts", enabled => {
    const guide = builtinFictionCraft(), instruction = "Keep the author's present-tense style.";
    const context = AuthoringInstructionsSchema.parse({ schemaVersion: 1, policy: "fiction-craft-v1", settingsVersionId: "edition-1", enabled, origin: "author-choice", selectedGuide: { id: guide.id, version: guide.version, sha256: guide.sha256 }, appliedGuide: enabled ? guide : null, customInstructions: [{ id: "custom", name: "voice", scope: "project", position: 0, instruction, sha256: sha256(instruction) }] });
    const messages = authoringMessages([{ role: "system", content: "Fixed schema and approval contract" }, { role: "user", content: "Specific approved task" }], context);
    expect(messages[0]!.content).toBe("Fixed schema and approval contract"); expect(messages.at(-1)!.content).toBe("Specific approved task");
    expect(JSON.stringify(messages)).toContain(instruction); expect(messages.some(m => m.content.includes(guide.text))).toBe(enabled);
    expect(messages.filter(m => m.content.includes(guide.text))).toHaveLength(enabled ? 1 : 0);
  });
});
