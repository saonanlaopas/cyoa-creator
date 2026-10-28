import { actNativePlayerWorld, chooseNativePlayerSession, createNativePlayerSession, previewChapterTransition, type NativeGameBundle, type NativePlayerConfig, type WorldCommand } from "../../packages/runtime/src/index.js";
import { finalChoice } from "./author.js";
/** Reproduction oracle uses the same public runtime as exports, with explicit expected outcomes tested separately. */
export function playDemo(bundle: NativeGameBundle, config: NativePlayerConfig, optional = true, late = false) {
  let session = createNativePlayerSession(bundle, config); const initial = session;
  const commands: WorldCommand[] = [...(optional ? [{ kind: "event" as const, id: "tide" }] : []), { kind: "travel", id: "home-cafe" }, { kind: "purchase", id: "buy-tea" }, { kind: "wait", minutes: optional ? 5 : 15 }, ...(late ? Array.from({ length: 24 }, () => ({ kind: "wait" as const, minutes: 60 })) : []), { kind: "gift", id: "share-tea" }, { kind: "event", id: "warning" }];
  for (const command of commands) session = actNativePlayerWorld(bundle, config, session, command).session;
  const afterWarning = session;
  const departure: WorldCommand = bundle.world!.progression!.chapters.length ? { kind: "chapter-transition", id: "next", previewFingerprint: previewChapterTransition(bundle.world!, session.state, "next").fingerprint } : { kind: "event", id: "depart" };
  session = actNativePlayerWorld(bundle, config, session, departure).session;
  session = actNativePlayerWorld(bundle, config, session, { kind: "event", id: "prepare" }).session;
  const prepared = session;
  session = chooseNativePlayerSession(bundle, config, session, finalChoice).session;
  return { initial, afterWarning, prepared, final: session, commands, departure };
}
