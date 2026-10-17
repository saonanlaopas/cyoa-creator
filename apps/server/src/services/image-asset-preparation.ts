import sharp from "sharp";
import { IMAGE_ASSET_LIMITS, type ImageAsset } from "@story-to-cyoa/domain";
import { encodeAssetPng, imageSha256 } from "@story-to-cyoa/persistence";

const types = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;
export async function prepareImageAsset(bytes: Buffer, sourceName: string, kind: ImageAsset["provenance"]["kind"], declaredMime?: string) {
  if (!bytes.length || bytes.length > IMAGE_ASSET_LIMITS.inputBytes) throw new Error("image_upload_size_exceeded: maximum 8 MB");
  const raster = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    || bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!raster) throw new Error("image_static_png_jpeg_webp_required");
  // libvips can expose only the first APNG frame. Check container chunk types, not raw byte matches.
  if (bytes[0] === 137) for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw new Error("image_decode_failed: incomplete PNG chunk");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") throw new Error("image_animation_unsupported: export a static PNG frame before importing");
    offset += length + 12; if (type === "IEND") break;
  }
  try {
    const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: IMAGE_ASSET_LIMITS.pixels });
    const metadata = await decoder.metadata(), format = metadata.format as keyof typeof types;
    if (!(format in types) || (metadata.pages ?? 1) !== 1) throw new Error("image_static_png_jpeg_webp_required");
    if (declaredMime && declaredMime !== "application/octet-stream" && declaredMime !== types[format]) throw new Error("image_mime_mismatch");
    if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > IMAGE_ASSET_LIMITS.side) throw new Error("image_dimensions_exceeded: maximum side 4096 pixels");
    const decoded = await decoder.autoOrient().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const image = encodeAssetPng(decoded.info.width, decoded.info.height, decoded.data);
    const thumb = await sharp(decoded.data, { raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 } })
      .resize({ width: IMAGE_ASSET_LIMITS.thumbnailSide, height: IMAGE_ASSET_LIMITS.thumbnailSide, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    const thumbnail = encodeAssetPng(thumb.info.width, thumb.info.height, thumb.data);
    if (thumbnail.bytes > IMAGE_ASSET_LIMITS.thumbnailBytes) throw new Error("image_thumbnail_size_exceeded");
    const safeName = sourceName.split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f]/g, "").slice(0, 120) || "image";
    return { image, thumbnail, provenance: { kind, sourceName: safeName, sourceSha256: imageSha256(bytes), sourceMimeType: types[format], normalization: "oriented-srgb-rgba-png-v1" as const, providerCalls: 0 as const } };
  } catch (error) {
    const message = (error as Error).message;
    throw new Error(message.startsWith("image_") ? message : "image_decode_failed: use a complete static PNG, JPEG or WebP within the image limits");
  }
}
