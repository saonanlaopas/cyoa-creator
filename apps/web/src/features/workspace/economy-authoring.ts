import type { WorldDefinition } from "@story-to-cyoa/domain";
export function economyDependencies(w: WorldDefinition, kind: "item" | "person" | "location" | "chapter" | "milestone" | "event", id: string): string[] {
  const e = w.economy, result: string[] = [];
  const conditions = (list: NonNullable<WorldDefinition["progression"]>["events"][number]["prerequisites"], label: string) => {
    if (list.some((c) => kind === "item" && c.kind === "item" && c.itemId === id || kind === "location" && c.kind === "location" && c.locationId === id
      || kind === "chapter" && c.kind === "chapter" && c.chapterId === id || kind === "milestone" && c.kind === "milestone" && c.milestoneId === id)) result.push(label + ": prerequisite");
  };
  for (const [i, s] of (e?.shops ?? []).entries()) {
    if (kind === "location" && s.locationId === id) result.push("Shop " + (i + 1));
    for (const [j, r] of s.offers.entries()) { const label = `Shop ${i + 1} offer ${j + 1}`; if (kind === "item" && r.itemId === id) result.push(label); conditions(r.prerequisites, label); }
  }
  for (const [i, r] of [...(e?.gifts ?? []), ...(e?.uses ?? [])].entries()) {
    const label = r.label || "Gift/use " + (i + 1);
    if (kind === "item" && r.itemId === id || kind === "person" && "characterId" in r && r.characterId === id) result.push(label);
    conditions(r.prerequisites, label);
    if (kind === "item" && r.effects.items.some((v) => v.itemId === id) || kind === "milestone" && r.effects.milestoneIds.includes(id)) result.push(label + ": effects");
  }
  for (const [i, r] of (e?.eventEffects ?? []).entries()) {
    const label = "Event transaction " + (i + 1);
    if (kind === "event" && r.eventId === id || kind === "item" && [...r.costs.items, ...r.effects.items].some((v) => v.itemId === id) || kind === "milestone" && r.effects.milestoneIds.includes(id)) result.push(label);
  }
  if (kind === "item") {
    for (const r of [...(w.progression?.events ?? []), ...(w.progression?.transitions ?? [])]) conditions(r.prerequisites, r.label);
    for (const [i, r] of (w.people?.overrides ?? []).entries()) conditions(r.prerequisites, "Story override " + (i + 1));
  }
  return [...new Set(result)];
}
export const hasEconomyPredicates = (w: WorldDefinition) => [...(w.progression?.events ?? []), ...(w.progression?.transitions ?? []), ...(w.people?.overrides ?? [])].some((r) => r.prerequisites.some((c) => c.kind === "item" || c.kind === "relationship"));
export const economyNeedsProgression = (w: WorldDefinition) => Boolean(w.economy && (w.economy.eventEffects.length || [...w.economy.gifts, ...w.economy.uses].some((r) => r.repeat.kind === "once-per-chapter" || r.effects.milestoneIds.length || r.prerequisites.some((c) => c.kind === "chapter" || c.kind === "milestone")) || w.economy.shops.some((s) => s.offers.some((r) => r.prerequisites.some((c) => c.kind === "chapter" || c.kind === "milestone")))));
