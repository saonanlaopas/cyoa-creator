import type { NativePreviewSelection } from "../../packages/pipeline/src/native-preview-boundary.js";
import type { WorldDefinition } from "../../packages/domain/src/world-definition.js";
import type { FoundationCall } from "./original-foundations.js";
import { openingSelection, previewChoice } from "./partial-preview.js";
import { authoredWorld } from "./world.js";

export const boundedSelection: NativePreviewSelection = { ...openingSelection, mode: "bounded-playtest", exclusions: [
  { kind: "choice", id: previewChoice, presentation: "disabled" },
  { kind: "travel", id: "home-station", presentation: "disabled" },
  { kind: "travel", id: "cafe-station", presentation: "hidden" },
  { kind: "action", id: "future-local", presentation: "hidden" },
  { kind: "wait", id: "60", presentation: "hidden" },
  { kind: "event", id: "future-encounter", presentation: "hidden" },
  { kind: "chapter-transition", id: "future-chapter", presentation: "disabled" },
  { kind: "purchase", id: "future-offer", presentation: "disabled" },
  { kind: "gift", id: "future-gift", presentation: "hidden" },
  { kind: "use", id: "future-use", presentation: "hidden" },
] };

export async function boundedWorld(call: FoundationCall, projectId: string, mapImage?: Parameters<typeof authoredWorld>[2]): Promise<WorldDefinition> {
  const world = await authoredWorld(call, projectId, mapImage);
  const stop = world.locations.find(location => location.id === "cafe")!.passage;
  const future = world.locations.find(location => location.id === "station")!.passage;
  const prerequisites = [{ kind: "location" as const, locationId: "home", present: true }, { kind: "chapter" as const, chapterId: "day-one", current: true }];
  const effects = { currency: 0, items: [], relationships: [], milestoneIds: [] };
  const rule = { itemId: "tea", quantity: 1, minutes: 3, prerequisites, repeat: { kind: "once" as const },
    effects: { ...effects, currency: 3 }, result: "The ledger records the exchange." };
  return { ...world,
    connections: [...world.connections, { id: "home-station", from: "home", to: "station", minutes: 10 }],
    actions: [...world.actions, { id: "future-local", locationId: "home", label: "Read the secret itinerary", minutes: 4, result: "The future itinerary opens." }],
    progression: { schemaId: "cyoa.world-progression", schemaVersion: 1,
      chapters: [{ id: "day-one", name: "Day one", final: false }, { id: "closing", name: "Closing", final: true }, { id: "later", name: "Secret future chapter", final: true }],
      initialChapterId: "day-one", milestones: [{ id: "corrected", name: "Ledger corrected" }], initialMilestoneIds: [],
      events: [
        { id: "correction", label: "Correct the ledger", prerequisites, repeat: { kind: "once" }, visibility: "always", passage: stop, minutes: 5,
          milestoneIds: ["corrected"], result: "The corrected ledger balances." },
        { id: "future-encounter", label: "Secret future encounter", prerequisites: [...prerequisites, { kind: "time", from: 1432, until: 1450 }],
          repeat: { kind: "once" }, visibility: "always", passage: future, minutes: 3, milestoneIds: [], result: "The secret destination is revealed." },
      ],
      transitions: [
        { id: "close-day", label: "Close the watch", fromChapterId: "day-one", toChapterId: "closing", prerequisites, carryMilestoneIds: [],
          expireEventIds: ["future-encounter"], passage: stop, minutes: 5, result: "The watch is closed." },
        { id: "future-chapter", label: "Secret future chapter", fromChapterId: "day-one", toChapterId: "later", prerequisites, carryMilestoneIds: [],
          expireEventIds: [], passage: future, minutes: 6, result: "A later day begins." },
      ],
    },
    people: { schemaId: "cyoa.world-people", schemaVersion: 1, characters: [{ id: "mara", name: "Mara" }],
      schedules: [
        { id: "mara-watch", characterId: "mara", locationId: "home", days: [0], from: 1400, until: 1440 },
        { id: "mara-future", characterId: "mara", locationId: "station", days: [1], from: 0, until: 60 },
      ],
      overrides: [{ id: "mara-off-map", characterId: "mara", locationId: "station", priority: 10, prerequisites: [{ kind: "time", from: 1440, until: 1450 }] }],
      events: [{ eventId: "correction", priority: 0, mandatory: false, characterIds: [] },
        { eventId: "future-encounter", priority: 1, mandatory: true, characterIds: ["mara"] }],
    },
    economy: { schemaId: "cyoa.world-economy", schemaVersion: 1, currency: { name: "Coins", initial: 5, maximum: 100 },
      items: [{ id: "tea", name: "Tea", description: "A hot cup for the watch.", maximum: 5, initial: 1, consumable: true }],
      shops: [{ id: "harbor-kiosk", name: "Harbor kiosk", locationId: "home", hours: null, offers: [
        { id: "future-offer", itemId: "tea", quantity: 1, price: 2, stock: 2, minutes: 3, prerequisites: [] },
      ] }],
      gifts: [{ id: "future-gift", label: "Secret future gift", characterId: "mara", ...rule }],
      uses: [{ id: "future-use", label: "Secret future use", ...rule }],
      eventEffects: [
        { eventId: "correction", costs: { currency: 1, items: [{ itemId: "tea", quantity: 1 }] }, effects: { ...effects, currency: 3 } },
        { eventId: "future-encounter", costs: { currency: 1, items: [{ itemId: "tea", quantity: 1 }] }, effects: { ...effects, currency: 8 } },
      ],
    },
  };
}
