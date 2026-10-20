import { encodeAssetPng } from "@story-to-cyoa/persistence";

// Deterministic, original offline portrait fixture; no remote or generated-provider media.
export function portraitImage(smiling = false): Buffer {
  const width = 180, height = 240, pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let color: number[] | undefined;
    if ((x - 90) ** 2 / 45 ** 2 + (y - 82) ** 2 / 65 ** 2 < 1) color = [45, 33, 43, 255];
    if ((x - 90) ** 2 / 35 ** 2 + (y - 90) ** 2 / 44 ** 2 < 1) color = [207, 157, 126, 255];
    if (y > 135 && y < 238 && Math.abs(x - 90) < 34 + (y - 135) * .24) color = [smiling ? 123 : 40, smiling ? 55 : 112, smiling ? 74 : 103, 255];
    if (y > 71 && y < 77 && (Math.abs(x - 77) < 4 || Math.abs(x - 103) < 4)) color = [35, 27, 31, 255];
    if (Math.abs(x - 90) < 12 && Math.abs(y - (smiling ? 109 - (x - 90) ** 2 / 50 : 106)) < 2) color = [110, 39, 43, 255];
    if (color) pixels.set(color, (y * width + x) * 4);
  }
  return Buffer.from(encodeAssetPng(width, height, pixels).base64, "base64");
}
