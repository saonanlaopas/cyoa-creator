import type { WorldDefinition, WorldJournalTrigger } from "@story-to-cyoa/domain";
export function journalDependencies(w: WorldDefinition, kind: "item" | "person" | "location" | "chapter" | "milestone" | "event", id: string): string[] {
  const j = w.journal; if (!j) return [];
  const lists: Array<{ label: string; conditions: WorldJournalTrigger[] }> = [
    ...j.character.map((r) => ({ label: `Character ${r.category} ${r.key}`, conditions: r.when })),
    ...j.locations.map((r) => ({ label: `Location reveal ${w.locations.find((l) => l.id === r.locationId)?.name ?? r.locationId}`, conditions: r.when })),
    ...j.entries.map((r) => ({ label: `Journal entry ${r.title || "Untitled"}`, conditions: r.when })),
    ...j.objectives.flatMap((r) => [{ label: `Objective ${r.title || "Untitled"}: reveal`, conditions: r.when }, { label: `Objective ${r.title || "Untitled"}: completion`, conditions: r.completeWhen }]),
  ];
  return [...(kind === "location" && j.locations.some((r) => r.locationId === id) ? ["Journal location reveal"] : []), ...lists.filter((r) => r.conditions.some((c) => kind === "item" && c.kind === "item" && c.itemId === id || kind === "location" && c.kind === "location" && c.locationId === id || kind === "chapter" && c.kind === "chapter" && c.chapterId === id || kind === "milestone" && c.kind === "milestone" && c.milestoneId === id || kind === "event" && c.kind === "event" && c.eventId === id)).map((r) => r.label)];
}
export const journalLists = (w: WorldDefinition) => w.journal ? [...w.journal.character, ...w.journal.locations, ...w.journal.entries, ...w.journal.objectives].map((r) => r.when).concat(w.journal.objectives.map((r) => r.completeWhen)) : [];
export const journalNeedsProgression = (w: WorldDefinition) => journalLists(w).some((list) => list.some((c) => c.kind === "event" || c.kind === "chapter" || c.kind === "milestone"));
