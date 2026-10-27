import type { WorldDefinition } from "../../packages/domain/src/world-definition.js";
import type { FoundationCall } from "./original-foundations.js";
export async function withAuthoredJournal(call: FoundationCall, projectId: string, world: WorldDefinition): Promise<WorldDefinition> {
  const options = await call("read_world", { projectId }), stat = options.statOptions[0].key, relationship = options.relationshipOptions.find((m: { label: string }) => m.label === "Trust with Mara").key;
  return { ...world, journal: { schemaId: "cyoa.world-journal", schemaVersion: 1,
    character: [{ category: "stat", key: stat, when: [] }, { category: "relationship", key: relationship, when: [{ kind: "relationship", key: relationship, minimum: 2, maximum: null }] }],
    locations: [{ locationId: "cafe", when: [] }, { locationId: "station", when: [{ kind: "event", eventId: "hello", minimum: 1 }] }],
    entries: [
      { id: "signal-note", title: "A fleeting signal", text: "A small lamp flashed before midnight.", when: [{ kind: "time", from: 1432, until: 1434 }] },
      { id: "mara-note", title: "Mara's confidence", text: "Mara entrusted you with the ledger clue.", when: [{ kind: "relationship", key: relationship, minimum: 2, maximum: null }] },
      { id: "secret-note", title: "Undisclosed journal title", text: "Undisclosed journal prose.", when: [{ kind: "time", from: 5000, until: null }] },
    ], objectives: [
      { id: "share", title: "Share a warm parcel", description: "Offer tea to Mara.", when: [], completeWhen: [{ kind: "relationship", key: relationship, minimum: 2, maximum: null }] },
      { id: "ledger", title: "Discuss the ledger", description: "Ask Mara about the signal clue.", when: [{ kind: "relationship", key: relationship, minimum: 2, maximum: null }], completeWhen: [{ kind: "event", eventId: "hello", minimum: 1 }] },
      { id: "secret-objective", title: "Undisclosed objective", description: "Undisclosed objective prose.", when: [{ kind: "time", from: 5000, until: null }], completeWhen: [{ kind: "event", eventId: "hello", minimum: 2 }] },
    ],
  } };
}
