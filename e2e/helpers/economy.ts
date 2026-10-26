import type { WorldDefinition } from "../../packages/domain/src/world-definition.js";
import { completeConnectedTextGame } from "./connected-text-game.js";
import { proposeFoundation, applyFoundation, approveFoundation, type FoundationCall } from "./original-foundations.js";
import { withAuthoredPeople } from "./people.js";
export async function completeEconomyTextGame(call: FoundationCall, projectId: string) {
  return completeConnectedTextGame(call, projectId, undefined, async () => {
    const bible = (await call("read_foundation", { projectId, artifactId: "bible" })).content;
    const proposal = await proposeFoundation(call, projectId, "bible", {}, [
      { targetKey: "bible:root", kind: "add-item", collection: "characters", item: { ...bible.characters[0], id: "$new:mara", name: "Mara", role: "Harbor neighbor", summary: "A neighbor who shares tea and information." } },
      { targetKey: "bible:root", kind: "add-item", collection: "relationships", item: { id: "$new:trust-mara", characterIds: [bible.characters[0].id, "$new:mara"], label: "Trust with Mara", currentState: "Cautious cooperation", plannedArc: "Authored gifts and decisions can change trust." } },
    ]);
    await applyFoundation(call, projectId, proposal.proposalId); await approveFoundation(call, projectId, "bible");
  });
}
export async function withAuthoredEconomy(call: FoundationCall, projectId: string, input: WorldDefinition): Promise<WorldDefinition> {
  const w = await withAuthoredPeople(call, projectId, input), p = w.progression!, people = w.people!;
  const key = (await call("read_world", { projectId })).relationshipOptions.find((r: { label: string }) => r.label === "Trust with Mara").key;
  people.events.forEach((r) => { r.mandatory = false; });
  people.overrides = [{ id: "mara-home", characterId: "mara", locationId: "home", priority: 10, prerequisites: [] }];
  p.events[0] = { ...p.events[0]!, label: "Discuss the ledger", prerequisites: [{ kind: "item", itemId: "tea", minimum: 1, maximum: null }, { kind: "relationship", key, minimum: 2, maximum: null }], milestoneIds: ["clue"], result: "Mara shares a useful ledger clue." };
  const effects = () => ({ currency: 0, items: [], relationships: [], milestoneIds: [] });
  return { ...w, economy: { schemaId: "cyoa.world-economy", schemaVersion: 1, currency: { name: "Coins", initial: 20, maximum: 100 },
    items: [{ id: "tea", name: "Tea", description: "A warming parcel to share or drink.", initial: 1, maximum: 20, consumable: true }, { id: "ticket", name: "Ticket", description: "A ticket for a later journey.", initial: 0, maximum: 5, consumable: false }],
    shops: [{ id: "harbor-kiosk", name: "Harbor kiosk", locationId: "home", hours: { opens: 1435, closes: 30 }, offers: [
      { id: "buy-tea", itemId: "tea", quantity: 1, price: 4, stock: 3, minutes: 2, prerequisites: [] },
      { id: "buy-ticket", itemId: "ticket", quantity: 1, price: 30, stock: 1, minutes: 0, prerequisites: [] },
      { id: "free-ticket", itemId: "ticket", quantity: 1, price: 0, stock: 2, minutes: 2, prerequisites: [] },
    ] }],
    gifts: [{ id: "gift-tea", label: "Share tea", characterId: "mara", itemId: "tea", quantity: 1, minutes: 1, prerequisites: [], repeat: { kind: "once-per-day" }, effects: { ...effects(), relationships: [{ key, delta: 2 }] }, result: "Mara appreciates the tea." }],
    uses: [{ id: "drink-tea", label: "Drink tea", itemId: "tea", quantity: 1, minutes: 1, prerequisites: [], repeat: { kind: "repeatable", cooldownMinutes: 5 }, effects: { ...effects(), currency: 1 }, result: "You drink the tea and redeem the cup." }],
    eventEffects: [{ eventId: "hello", costs: { currency: 1, items: [{ itemId: "tea", quantity: 1 }] }, effects: { ...effects(), currency: 6, items: [{ itemId: "tea", delta: 1 }] } }],
  } };
}
