import type { NativeEconomy } from "../src/index.js";
import { peopleFixture } from "./people-fixture.js";
export function economyFixture() {
  const f = peopleFixture();
  f.people.events.forEach((r) => { r.mandatory = false; });
  f.people.overrides = [{ id: "at-home", characterId: "mara", locationId: "home", priority: 10, prerequisites: [] }];
  f.progression.events[0]!.prerequisites = [{ kind: "item", itemId: "tea", minimum: 1, maximum: null }, { kind: "relationship", key: "trust", minimum: 1, maximum: null }];
  const effects = () => ({ currency: 0, items: [], relationships: [], milestoneIds: [] });
  const economy: NativeEconomy = { schemaId: "cyoa.native-economy", schemaVersion: 1,
    relationships: [{ key: "trust", minimum: 0, maximum: 5, initial: 0 }], currency: { name: "Coins", initial: 20, maximum: 100 },
    items: [{ id: "tea", name: "Tea", description: "A warm parcel of tea.", maximum: 20, initial: 0, consumable: true }, { id: "ticket", name: "Ticket", description: "A rail ticket.", maximum: 5, initial: 0, consumable: false }],
    shops: [{ id: "kiosk", name: "Harbor kiosk", locationId: "home", hours: { opens: 1320, closes: 120 },
      offers: [{ id: "buy-tea", itemId: "tea", quantity: 1, price: 4, stock: 10, minutes: 2, prerequisites: [] }, { id: "buy-ticket", itemId: "ticket", quantity: 1, price: 30, stock: 1, minutes: 0, prerequisites: [] }] }],
    gifts: [{ id: "gift-tea", label: "Share tea", characterId: "mara", itemId: "tea", quantity: 1, minutes: 1, prerequisites: [], repeat: { kind: "repeatable", cooldownMinutes: 0 }, effects: { ...effects(), relationships: [{ key: "trust", delta: 1 }] }, result: "Mara appreciates the tea." }],
    uses: [{ id: "drink-tea", label: "Drink tea", itemId: "tea", quantity: 1, minutes: 1, prerequisites: [], repeat: { kind: "repeatable", cooldownMinutes: 0 }, effects: { ...effects(), currency: 1 }, result: "You drink the tea and redeem the cup." }],
    eventEffects: [{ eventId: "hello", costs: { currency: 1, items: [{ itemId: "tea", quantity: 1 }] }, effects: { ...effects(), currency: 6, milestoneIds: ["clue"] } }],
  };
  f.world.economy = economy;
  return { ...f, economy, initial: f.refresh() };
}
