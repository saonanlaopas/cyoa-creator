import { createNativePlayerConfig, createNativePlayerSession, initialWorldState, nativeBundleFingerprint, type NativeJournal } from "../src/index.js";
import { economyFixture } from "./economy-fixture.js";
export function journalFixture() {
  const f = economyFixture();
  const journal: NativeJournal = { schemaId: "cyoa.native-journal", schemaVersion: 1,
    mechanics: [{ category: "stat", key: "resolve", label: "Resolve", minimum: 0, maximum: 5, initial: 0 }, { category: "relationship", key: "trust", label: "Trust with Mara", minimum: 0, maximum: 5, initial: 0 }],
    character: [{ category: "stat", key: "resolve", when: [] }, { category: "relationship", key: "trust", when: [{ kind: "relationship", key: "trust", minimum: 1, maximum: null }] }],
    locations: [{ locationId: "cafe", when: [] }, { locationId: "station", when: [{ kind: "event", eventId: "hello", minimum: 1 }] }],
    entries: [
      { id: "tea-note", title: "Mara's parcel", text: "Mara trusts you with the signal.", when: [{ kind: "relationship", key: "trust", minimum: 1, maximum: null }] },
      { id: "minute-note", title: "Fleeting signal", text: "A brief signal flashed.", when: [{ kind: "time", from: 1432, until: 1434 }] },
      { id: "secret-note", title: "Secret future", text: "Never disclosed now.", when: [{ kind: "time", from: 4000, until: null }] },
    ],
    objectives: [{ id: "discuss", title: "Discuss the signal", description: "Share tea, then speak with Mara.", when: [], completeWhen: [{ kind: "event", eventId: "hello", minimum: 1 }] },
      { id: "secret-objective", title: "Secret objective", description: "Future instruction.", when: [{ kind: "time", from: 4000, until: null }], completeWhen: [{ kind: "event", eventId: "hello", minimum: 1 }] }],
  };
  f.world.journal = journal;
  const refresh = () => { f.bundle.initialState.world = initialWorldState(f.world); f.bundle.bundleFingerprint = nativeBundleFingerprint(f.bundle); return createNativePlayerSession(f.bundle, f.config); };
  return { ...f, journal, refresh, initial: refresh(), visibleConfig: createNativePlayerConfig({ gameId: f.bundle.gameId, visibleMechanics: [{ key: "trust", label: "Trust", category: "relationship" }] }, f.bundle) };
}
