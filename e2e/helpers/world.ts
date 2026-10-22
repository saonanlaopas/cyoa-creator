import { encodeAssetPng } from "../../packages/persistence/src/image-asset-validation.js";
import type { WorldDefinition } from "../../packages/domain/src/world-definition.js";
import type { FoundationCall } from "./original-foundations.js";

export async function authoredWorld(call: FoundationCall, projectId: string, mapImage: WorldDefinition["locations"][number]["mapImage"] = null): Promise<WorldDefinition> {
  const passage = async (passageId: string) => ({ passageId, versionId: (await call("read_game_record", { projectId, kind: "passage", entityId: passageId })).record.id });
  return { schemaId: "cyoa.world-definition", schemaVersion: 1, enabled: true, startLocationId: "home", initialMinutes: 1430, waitMinutes: [15, 60, 1440],
    locations: [
      { id: "town", name: "Harbor district", parentId: null, passage: null, mapImage, marker: null, hours: null },
      { id: "home", name: "Home", parentId: "town", passage: await passage("passage-shared-opening"), mapImage: null, marker: { x: 20, y: 35 }, hours: null },
      { id: "cafe", name: "Cafe", parentId: "town", passage: await passage("passage-shared-route-pivot"), mapImage: null, marker: { x: 50, y: 65 }, hours: { opens: 1320, closes: 120 } },
      { id: "station", name: "Station", parentId: "town", passage: await passage("passage-route-1-act"), mapImage: null, marker: { x: 80, y: 35 }, hours: null },
    ],
    connections: [
      { id: "home-cafe", from: "home", to: "cafe", minutes: 15 }, { id: "cafe-home", from: "cafe", to: "home", minutes: 15 },
      { id: "cafe-station", from: "cafe", to: "station", minutes: 10 }, { id: "station-home", from: "station", to: "home", minutes: 20 },
    ], actions: [{ id: "read-board", locationId: "station", label: "Read departure board", minutes: 5, result: "The early train leaves at dawn." }],
  };
}

// Original deterministic offline bitmap: park blocks, roads, buildings and harbor. Controls are separate DOM markers.
export function townMap(): Buffer {
  const image = { width: 640, height: 400, data: Buffer.alloc(640 * 400 * 4) };
  const rect = (x: number, y: number, w: number, h: number, color: number[]) => {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) { const i = (py * image.width + px) * 4; image.data.set([...color, 255], i); }
  };
  rect(0, 0, 640, 400, [116, 168, 130]); rect(0, 325, 640, 75, [60, 155, 181]);
  rect(0, 180, 640, 22, [225, 230, 226]); rect(307, 0, 26, 325, [225, 230, 226]);
  rect(115, 130, 24, 65, [225, 230, 226]); rect(501, 130, 24, 65, [225, 230, 226]);
  rect(85, 90, 86, 60, [239, 225, 197]); rect(80, 85, 96, 15, [155, 75, 84]); rect(120, 118, 17, 32, [72, 84, 80]);
  rect(277, 240, 86, 60, [247, 237, 198]); rect(270, 235, 100, 15, [204, 99, 72]); rect(292, 263, 20, 20, [65, 139, 158]);
  rect(464, 90, 97, 60, [224, 229, 230]); rect(457, 85, 111, 15, [68, 91, 111]);
  for (let x = 470; x < 555; x += 22) rect(x, 112, 13, 18, [65, 139, 158]);
  return Buffer.from(encodeAssetPng(image.width, image.height, image.data).base64, "base64");
}
