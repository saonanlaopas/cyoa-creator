import { z } from "zod";
import {
  NativeProjectedWorldSchema, PlaytestExclusionSchema, playtestActionKey, type NativeWorld, type PlaytestExclusion,
  type PlaytestRestriction,
} from "@story-to-cyoa/runtime";
import type { ChoicePlan, PassagePlan } from "./schemas/passage-plan.js";

const id = z.string().min(1).max(200);
const endpoints = {
  sourcePassageId: id.optional(), sourceLocationId: id.optional(), sourceChapterId: id.optional(), sourceCharacterId: id.optional(),
  destinationPassageId: id.optional(), destinationLocationId: id.optional(), destinationChapterId: id.optional(),
};
export const BoundedPlaytestReviewSchema = z.object({
  exclusions: z.array(PlaytestExclusionSchema.extend({ ...endpoints, label: z.string().max(500), destinationTitle: z.string().max(300).optional(), mandatory: z.boolean().optional() }).strict()).max(100),
  omitted: z.array(z.object({ kind: z.string().max(40), id, ownerId: id.optional() }).strict()).max(1000),
}).strict();
type Review = z.infer<typeof BoundedPlaytestReviewSchema>;
type Action = Omit<Review["exclusions"][number], "presentation">;
type Block = (source: string, id: string, passageId: string, message: string) => void;
type Condition = { kind: string; locationId?: string; eventId?: string };

export function projectBoundedWorld(
  world: NativeWorld, selected: ReadonlySet<string>, passages: ReadonlyMap<string, PassagePlan>, choices: ChoicePlan[],
  requested: PlaytestExclusion[], block: Block,
) {
  const locations = new Map(world.locations.map(location => [location.id, location]));
  const locationByPassage = new Map(world.locations.filter(location => location.passageId).map(location => [location.passageId, location.id]));
  for (const location of world.locations) if (location.passageId && !passages.has(location.passageId)) {
    block("world location", location.id, location.passageId, `World location ${location.id} has a missing canonical passage ${location.passageId}.`);
  }
  const keepLocations = new Set<string>();
  for (const location of world.locations) if (location.passageId && selected.has(location.passageId)) {
    for (let next: typeof location | undefined = location; next && !keepLocations.has(next.id); next = locations.get(next.parentId ?? "")) {
      if (next.passageId && !selected.has(next.passageId)) {
        block("world location", next.id, next.passageId, `Location ${location.id} needs excluded parent ${next.id}. Include its passage to preserve the map hierarchy.`);
        break;
      }
      keepLocations.add(next.id);
    }
  }
  const at = (id: string) => {
    const passageId = locations.get(id)?.passageId;
    return { sourceLocationId: id, ...(passageId ? { sourcePassageId: passageId } : {}) };
  };
  const progression = world.progression, people = world.people, economy = world.economy, journal = world.journal;
  const source = (prerequisites: NonNullable<NativeWorld["progression"]>["events"][number]["prerequisites"]) => {
    const location = prerequisites.find(c => c.kind === "location" && c.present);
    const chapter = prerequisites.find(c => c.kind === "chapter" && c.current);
    return { ...(location?.kind === "location" ? at(location.locationId) : {}), ...(chapter?.kind === "chapter" ? { sourceChapterId: chapter.chapterId } : {}) };
  };
  const actions: Action[] = [
    ...choices.map(choice => ({ kind: "choice" as const, id: choice.id, label: choice.label, sourcePassageId: choice.sourcePassageId, destinationPassageId: choice.destinationPassageId })),
    ...world.connections.map(c => ({ kind: "travel" as const, id: c.id, label: `Travel to ${locations.get(c.to)?.name ?? c.to}`,
      ...at(c.from), destinationLocationId: c.to, ...(locations.get(c.to)?.passageId ? { destinationPassageId: locations.get(c.to)!.passageId! } : {}) })),
    ...world.actions.map(item => ({ kind: "action" as const, id: item.id, label: item.label, ...at(item.locationId) })),
    ...world.waitMinutes.map(minutes => ({ kind: "wait" as const, id: String(minutes), label: `Wait ${minutes} min` })),
    ...(progression?.events ?? []).map(event => ({ kind: "event" as const, id: event.id, label: event.label, ...source(event.prerequisites),
      ...(event.passageId ? { destinationPassageId: event.passageId } : {}), mandatory: people?.events.some(item => item.eventId === event.id && item.mandatory) ?? false })),
    ...(progression?.transitions ?? []).map(item => ({ kind: "chapter-transition" as const, id: item.id, label: item.label,
      ...source(item.prerequisites), sourceChapterId: item.fromChapterId, destinationChapterId: item.toChapterId, ...(item.passageId ? { destinationPassageId: item.passageId } : {}) })),
    ...(economy?.shops ?? []).flatMap(shop => shop.offers.map(item => ({ kind: "purchase" as const, id: item.id,
      label: `Buy ${economy!.items.find(i => i.id === item.itemId)?.name ?? item.itemId}`, ...at(shop.locationId) }))),
    ...(economy?.gifts ?? []).map(item => ({ kind: "gift" as const, id: item.id, label: item.label, ...source(item.prerequisites), sourceCharacterId: item.characterId })),
    ...(economy?.uses ?? []).map(item => ({ kind: "use" as const, id: item.id, label: item.label, ...source(item.prerequisites) })),
  ];
  const byKey = new Map(actions.map(item => [playtestActionKey(item), item]));
  const review: Review = { exclusions: [], omitted: [] };
  const excluded = new Set<string>();
  for (const exclusion of requested) {
    const key = playtestActionKey(exclusion), action = byKey.get(key);
    if (!action || excluded.has(key)) {
      block("exclusion", exclusion.id, "", action ? `Duplicate exclusion for ${key}.` : `Exclusion ${key} is not an exact command in the reviewed World or selected choices.`);
      continue;
    }
    excluded.add(key);
    const destination = action.destinationPassageId ? passages.get(action.destinationPassageId) : undefined;
    const location = action.destinationPassageId ? locationByPassage.get(action.destinationPassageId) : undefined;
    review.exclusions.push({ ...action, ...(destination ? { destinationTitle: destination.title } : {}),
      ...(location ? { destinationLocationId: location } : {}), presentation: exclusion.presentation });
  }
  const restrictions: PlaytestRestriction[] = review.exclusions.map(({ kind, id, presentation, sourcePassageId, sourceLocationId, sourceChapterId }) => ({
    kind, id, presentation, ...(kind === "choice" && sourcePassageId ? { sourcePassageId } : {}),
    ...(sourceLocationId ? { sourceLocationId } : {}), ...(sourceChapterId ? { sourceChapterId } : {}),
  }));
  const has = (kind: Action["kind"], id: string) => excluded.has(playtestActionKey({ kind, id }));
  for (const item of actions) {
    if (item.destinationPassageId && !passages.has(item.destinationPassageId)) {
      block(item.kind, item.id, item.destinationPassageId, `${item.kind} ${item.id} has a missing canonical destination ${item.destinationPassageId}.`);
    } else if (item.destinationPassageId && !selected.has(item.destinationPassageId) && !has(item.kind, item.id)
      && (item.kind !== "travel" || keepLocations.has(item.sourceLocationId!))) {
      block(item.kind, item.id, item.destinationPassageId, `${item.kind} ${item.id} (${item.label}) reaches excluded passage ${item.destinationPassageId}. Include it or explicitly exclude this command.`);
    }
  }
  const keep = <T extends { id: string }>(items: T[], kind: string, predicate: (item: T) => boolean) => items.filter(item => {
    if (predicate(item)) return true;
    review.omitted.push({ kind, id: item.id });
    return false;
  });
  const allowedConditions = (kind: string, id: string, conditions: Condition[]) => {
    for (const condition of conditions) {
      if (condition.kind === "location" && condition.locationId && !keepLocations.has(condition.locationId)) {
        const passage = locations.get(condition.locationId)?.passageId;
        block(kind, id, passage ?? "", `${kind} ${id} depends on excluded location ${condition.locationId}. Include that location or exclude the command if applicable.`);
      }
      if (condition.kind === "event" && condition.eventId && has("event", condition.eventId)) {
        block(kind, id, "", `${kind} ${id} depends on excluded event ${condition.eventId}. Keep that event or revise the journal in a separate authoring action.`);
      }
    }
  };
  const keptLocations = keep(world.locations, "location", item => keepLocations.has(item.id));
  const usedAssets = new Set(keptLocations.map(location => location.mapImage));
  const connections = keep(world.connections.filter(c => !has("travel", c.id)), "travel", c => keepLocations.has(c.from));
  const localActions = keep(world.actions.filter(a => !has("action", a.id)), "action", a => keepLocations.has(a.locationId));
  const events = progression?.events.filter(item => !has("event", item.id));
  const transitions = progression?.transitions.filter(item => !has("chapter-transition", item.id)).map(item => ({
    ...item, expireEventIds: item.expireEventIds.filter(id => !has("event", id)),
  }));
  for (const item of events ?? []) allowedConditions("World event", item.id, item.prerequisites);
  for (const item of transitions ?? []) allowedConditions("World chapter transition", item.id, item.prerequisites);
  const schedules = people && keep(people.schedules, "schedule", item => keepLocations.has(item.locationId));
  const overrides = people?.overrides.map(item => {
    allowedConditions("World schedule override", item.id, item.prerequisites);
    if (!item.locationId || keepLocations.has(item.locationId)) return item;
    // The override still wins over a lower priority on-map schedule: the person is off-map.
    review.omitted.push({ kind: "override-destination", id: item.id, ownerId: item.locationId });
    return { ...item, locationId: null };
  });
  const shops = economy && keep(economy.shops, "shop", item => keepLocations.has(item.locationId)).map(shop => ({
    ...shop, offers: shop.offers.filter(item => !has("purchase", item.id)),
  }));
  const gifts = economy?.gifts.filter(item => !has("gift", item.id)), uses = economy?.uses.filter(item => !has("use", item.id));
  for (const shop of shops ?? []) for (const offer of shop.offers) allowedConditions("World purchase", offer.id, offer.prerequisites);
  for (const item of gifts ?? []) allowedConditions("World gift", item.id, item.prerequisites);
  for (const item of uses ?? []) allowedConditions("World item use", item.id, item.prerequisites);
  const journalLocations = journal?.locations.filter(item => {
    if (keepLocations.has(item.locationId)) return true;
    review.omitted.push({ kind: "journal-location", id: item.locationId });
    return false;
  });
  for (const item of journal?.character ?? []) allowedConditions("World journal character", item.key, item.when);
  for (const item of journalLocations ?? []) allowedConditions("World journal location", item.locationId, item.when);
  for (const item of journal?.entries ?? []) allowedConditions("World journal entry", item.id, item.when);
  for (const item of journal?.objectives ?? []) allowedConditions("World journal objective", item.id, [...item.when, ...item.completeWhen]);
  const projected: NativeWorld = {
    ...world, locations: keptLocations, connections, actions: localActions, assets: world.assets.filter(asset => usedAssets.has(asset.id)),
    waitMinutes: world.waitMinutes.filter(minutes => !has("wait", String(minutes))),
    ...(progression ? { progression: { ...progression, events: events!, transitions: transitions! } } : {}),
    ...(people ? { people: { ...people, schedules: schedules!, overrides: overrides!, events: people.events.filter(item => !has("event", item.eventId)) } } : {}),
    ...(economy ? { economy: { ...economy, shops: shops!, gifts: gifts!, uses: uses!, eventEffects: economy.eventEffects.filter(item => !has("event", item.eventId)) } } : {}),
    ...(journal ? { journal: { ...journal, locations: journalLocations! } } : {}),
  };
  const parsed = NativeProjectedWorldSchema.safeParse(projected);
  if (!parsed.success) for (const issue of parsed.error.issues.slice(0, 8)) {
    block("world projection", "world", "", `Projected World is invalid: ${issue.message}`);
  }
  return { world: projected, review, restrictions, retainedChoices: choices.filter(choice => !has("choice", choice.id)) };
}

/** Track locations and chapters structurally; leave time, flags, prerequisites and costs to actual play. */
export function hasBoundedPath(world: NativeWorld, choices: ChoicePlan[], passages: ReadonlyMap<string, PassagePlan>, start: string, stop: string) {
  type State = { passage: string; location: string; chapter: string | null };
  const byLocation = new Map(world.locations.map(item => [item.id, item.passageId]));
  const byPassage = new Map(world.locations.filter(item => item.passageId).map(item => [item.passageId, item.id]));
  const queue: State[] = [], seen = new Set<string>();
  const add = (passage: string, location: string, chapter: string | null) => {
    const key = JSON.stringify([passage, location, chapter]);
    if (!seen.has(key)) { seen.add(key); queue.push({ passage, location, chapter }); }
  };
  const from = new Map<string, ChoicePlan[]>();
  for (const choice of choices) {
    const entries = from.get(choice.sourcePassageId) ?? [];
    entries.push(choice); from.set(choice.sourcePassageId, entries);
  }
  add(start, world.startLocationId, world.progression?.initialChapterId ?? null);
  for (const state of queue) {
    if (state.passage === stop) return true;
    if (passages.get(state.passage)?.terminal) continue;
    const enter = (passage: string, chapter = state.chapter) => add(passage, byPassage.get(passage) ?? state.location, chapter);
    const allows = (conditions: NonNullable<NativeWorld["progression"]>["events"][number]["prerequisites"]) =>
      conditions.every(c => c.kind === "chapter" ? (c.chapterId === state.chapter) === c.current
        : c.kind === "location" ? (c.locationId === state.location) === c.present : true);
    for (const choice of from.get(state.passage) ?? []) enter(choice.destinationPassageId);
    for (const c of world.connections) {
      const destination = byLocation.get(c.to);
      if (c.from === state.location && destination) add(destination, c.to, state.chapter);
    }
    for (const event of world.progression?.events ?? []) if (event.passageId && allows(event.prerequisites)) enter(event.passageId);
    for (const transition of world.progression?.transitions ?? []) if (transition.fromChapterId === state.chapter && allows(transition.prerequisites)) {
      enter(transition.passageId ?? state.passage, transition.toChapterId);
    }
  }
  return false;
}
