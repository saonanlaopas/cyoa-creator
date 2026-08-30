import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  chooseNativePlayerSession,
  createNativePlayerConfig,
  createNativePlayerSave,
  createNativePlayerSession,
} from "../../src/index.js";
import { playerConfigInput, playerFixture } from "../native-player-fixture.js";

const bundle = playerFixture(5);
const config = createNativePlayerConfig(playerConfigInput(bundle), bundle);
let session = createNativePlayerSession(bundle, config);
session = chooseNativePlayerSession(bundle, config, session, "choice-0").session;
session = chooseNativePlayerSession(bundle, config, session, "choice-1").session;
const save = createNativePlayerSave(bundle, config, session, {
  label: "Frozen v1 checkpoint",
  savedAt: "2026-08-30T00:00:00.000Z",
});
const output = fileURLToPath(new URL("./native-player-save-v1.json", import.meta.url));
writeFileSync(output, `${JSON.stringify({ bundle, config, save }, null, 2)}\n`, "utf8");
