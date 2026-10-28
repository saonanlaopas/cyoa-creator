import type { WorldDefinition } from "../../packages/domain/src/world-definition.js";
type Ref = { passageId: string; versionId: string };
type Image = { assetId: string; versionId: string };
/** The two configurations use accepted contracts; no runtime branch is specific to this demo. */
export function demoWorld(refs: Record<string, Ref>, mapImage: Image, trust: string, chapterLed = true): WorldDefinition {
  const chapter = chapterLed ? [{ kind: "chapter" as const, chapterId: "gather", current: true }] : [];
  const clue = { kind: "milestone" as const, milestoneId: "warning", achieved: true };
  const at = (locationId: string) => ({ kind: "location" as const, locationId, present: true });
  const effects = () => ({ currency: 0, items: [], relationships: [], milestoneIds: [] });
  const departure = { id: "depart", label: "Take the warning to the station", prerequisites: [clue, at("cafe")], visibility: "always" as const, repeat: { kind: "once" as const }, passage: refs.station!, minutes: 2, milestoneIds: ["departed"], result: "You and Mara carry the warning to the station. Prepare the signal together." };
  return { schemaId: "cyoa.world-definition", schemaVersion: 1, enabled: true, startLocationId: "home", initialMinutes: 420, waitMinutes: [1, 5, 15, 60, 1440],
    locations: [
      { id: "harbor", name: "Harbor district", parentId: null, passage: null, mapImage, marker: null, hours: null },
      { id: "home", name: "Keeper's house", parentId: "harbor", passage: refs.home!, mapImage: null, marker: { x: 20, y: 35 }, hours: null },
      { id: "cafe", name: "Quay cafe", parentId: "harbor", passage: refs.cafe!, mapImage: null, marker: { x: 50, y: 65 }, hours: null },
      { id: "station", name: "Signal station", parentId: "harbor", passage: refs.station!, mapImage: null, marker: { x: 80, y: 35 }, hours: null },
    ], connections: [{ id: "home-cafe", from: "home", to: "cafe", minutes: 7 }, { id: "cafe-home", from: "cafe", to: "home", minutes: 7 }, { id: "cafe-station", from: "cafe", to: "station", minutes: 5 }, { id: "station-cafe", from: "station", to: "cafe", minutes: 5 }], actions: [],
    progression: { schemaId: "cyoa.world-progression", schemaVersion: 1,
      chapters: chapterLed ? [{ id: "gather", name: "I · A cup before the storm", final: false }, { id: "signal", name: "II · An honest light", final: true }] : [], initialChapterId: chapterLed ? "gather" : null,
      milestones: [{ id: "memory", name: "The harbor's rhythm" }, { id: "warning", name: "Mara's warning" }, { id: "departed", name: "Warning carried" }, { id: "prepared", name: "Signal prepared" }], initialMilestoneIds: [],
      events: [
        { id: "tide", label: "Listen to the tide (optional)", prerequisites: [at("home"), ...chapter], visibility: "always", repeat: { kind: "once" }, passage: null, minutes: 3, milestoneIds: ["memory"], result: "Three quiet minutes settle your hands. You remember the rhythm of the harbor. This was optional; head to the quay cafe when ready." },
        { id: "warning", label: "Hear Mara's warning", prerequisites: [at("cafe"), { kind: "relationship", key: trust, minimum: 2, maximum: null }, ...chapter], visibility: "when-available", repeat: { kind: "once" }, passage: null, minutes: 5, milestoneIds: ["warning"], result: "Mara cups the tea in both hands. The shutter is cracked, she says. An honest steady light will guide the boats. She agrees to help. Take the warning to the station." },
        { id: "prepare", label: "Prepare the honest signal", prerequisites: [at("station"), clue, { kind: "relationship", key: trust, minimum: 2, maximum: 2 }, ...(chapterLed ? [{ kind: "chapter" as const, chapterId: "signal", current: true }] : [{ kind: "milestone" as const, milestoneId: "departed", achieved: true }])], visibility: "always", repeat: { kind: "once" }, passage: null, minutes: 3, milestoneIds: ["prepared"], result: "Mara holds the shutter while you align the lens. Trust with Mara rises to 3. The signal is ready: choose Light the honest signal below to finish, or explore the other authored resolutions." },
        ...(!chapterLed ? [departure] : []),
      ], transitions: chapterLed ? [{ id: "next", label: "Begin II · An honest light", fromChapterId: "gather", toChapterId: "signal", prerequisites: [clue, at("cafe")], carryMilestoneIds: ["memory", "warning"], expireEventIds: ["tide"], passage: refs.station!, minutes: 2, result: departure.result }] : [],
    },
    people: { schemaId: "cyoa.world-people", schemaVersion: 1, characters: [{ id: "mara", name: "Mara" }],
      schedules: [{ id: "morning-cafe", characterId: "mara", locationId: "cafe", days: [0, 1, 2, 3, 4, 5, 6], from: 435, until: 495 }], overrides: [{ id: "join-the-watch", characterId: "mara", locationId: "station", priority: 10, prerequisites: chapterLed ? [{ kind: "chapter", chapterId: "signal", current: true }] : [{ kind: "milestone", milestoneId: "departed", achieved: true }] }], events: [{ eventId: "warning", priority: 20, mandatory: true, characterIds: ["mara"] }, ...["tide", "prepare", ...(!chapterLed ? ["depart"] : [])].map((eventId) => ({ eventId, priority: 0, mandatory: false, characterIds: eventId === "prepare" ? ["mara"] : [] }))] },
    economy: { schemaId: "cyoa.world-economy", schemaVersion: 1, currency: { name: "Coins", initial: 6, maximum: 99 },
      items: [{ id: "tea", name: "Tea", description: "A warm parcel reserved for Mara. Share it using Give a gift when she is here.", maximum: 1, initial: 0, consumable: false }],
      shops: [{ id: "cafe-counter", name: "Quay cafe counter", locationId: "cafe", hours: { opens: 360, closes: 1320 }, offers: [{ id: "buy-tea", itemId: "tea", quantity: 1, price: 3, stock: 1, minutes: 2, prerequisites: [] }] }],
      gifts: [{ id: "share-tea", label: "Share a warm cup", characterId: "mara", itemId: "tea", quantity: 1, minutes: 1, prerequisites: [], repeat: { kind: "once" }, effects: { ...effects(), relationships: [{ key: trust, delta: 2 }] }, result: "You offer the tea without asking anything in return. Trust with Mara rises to 2. Return to Explore to hear her warning." }], uses: [],
      eventEffects: [{ eventId: "prepare", costs: { currency: 0, items: [] }, effects: { ...effects(), relationships: [{ key: trust, delta: 1 }] } }],
    }, journal: { schemaId: "cyoa.world-journal", schemaVersion: 1,
      character: [{ category: "relationship", key: trust, when: [] }], locations: ["home", "cafe", "station"].map((locationId) => ({ locationId, when: [] })),
      entries: [
        { id: "guide", title: "A note for the morning", text: "Use Explore to visit the Quay cafe (7 min). Buy one Tea in Shops here. Mara often stops by after quarter past seven; wait if she is absent. Give a gift, then hear her warning in Explore. Carry the warning to the station, prepare the signal, then choose Light the honest signal. Listening to the tide at home is optional. Maps, menus and reading are free. If you miss Mara today, she returns each morning.", when: [] },
        { id: "memory", title: "The harbor's rhythm", text: "You took time to listen. The rhythm stays with you, even when the chapter changes.", when: [{ kind: "event", eventId: "tide", minimum: 1 }] },
        { id: "warning", title: "The cracked shutter", text: "Mara's warning: hold the cracked shutter steady and show an honest light. She will help when you prepare the signal at the station.", when: [{ kind: "event", eventId: "warning", minimum: 1 }] },
        { id: "ready", title: "An honest light", text: "You prepared the signal together. The final authored choice is now available in Explore. Trust with Mara is 3.", when: [{ kind: "milestone", milestoneId: "prepared", achieved: true }] },
      ], objectives: [
        { id: "cup", title: "Share tea with Mara", description: "Visit the cafe, buy Tea and offer it when Mara is here.", when: [], completeWhen: [{ kind: "relationship", key: trust, minimum: 2, maximum: null }] },
        { id: "warning", title: "Hear the warning", description: "Return to Explore after sharing tea.", when: [{ kind: "relationship", key: trust, minimum: 2, maximum: null }], completeWhen: [{ kind: "event", eventId: "warning", minimum: 1 }] },
        { id: "signal", title: "Prepare an honest signal", description: "Carry the warning to the station, then prepare the signal there.", when: [{ kind: "event", eventId: "warning", minimum: 1 }], completeWhen: [{ kind: "milestone", milestoneId: "prepared", achieved: true }] },
      ] },
  };
}
