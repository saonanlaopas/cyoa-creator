import type { ImageAssetMetadata } from "../../packages/domain/src/image-asset.js";
import { encodeAssetPng } from "../../packages/persistence/src/image-asset-validation.js";
export const imageMetadata: ImageAssetMetadata = { title: "Harbor study", description: "A bright harbor study with a red signal tower and blue water.", altText: "Red signal tower beside blue water", tags: ["harbor", "study"], credit: "Offline fixture", license: "CC0" };
export function fixtureImage(width = 512, height = 320, alternate = false) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const tower = x > width * .58 && x < width * .7 && y > height * .12 && y < height * .76;
    const index = (y * width + x) * 4, water = y > height * .65;
    pixels[index] = tower ? 224 : water ? 29 : alternate ? 245 : 135;
    pixels[index + 1] = tower ? 82 : water ? 128 : alternate ? 190 : 214;
    pixels[index + 2] = tower ? 91 : water ? 177 : alternate ? 70 : 231; pixels[index + 3] = 255;
  }
  return Buffer.from(encodeAssetPng(width, height, pixels).base64, "base64");
}
