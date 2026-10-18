# Asset Library (V1)

The library accepts images as candidates, separately reviews/approves them, and preserves immutable replacement history. It does not assign scenes, render illustrations in the player, generate images, call a provider, or change accepted text games. Those runtime assignments belong to V2.

## Creator

Open **Asset library** from any Long-form project. **New asset** accepts one static PNG, JPEG or WebP with title, description and alternative text. Credit, license and tags are authored metadata; an unspecified license remains a review warning, not a claim of permission.

An upload creates an unapproved candidate. **Review candidate** shows its full image, metadata, license findings and any retained approved image. Explicitly review the exact content before **Approve candidate** or **Reject candidate**. Editing local fields invalidates the displayed review; saving metadata makes another candidate. Uploading a replacement binds to the exact current asset version and never silently replaces the retained approved image.

**History** inspects prior metadata and full image bytes, with bounded pagination. Historical views cannot overwrite newer work. **Return to current version** and **Refresh assets** recover after external edits or stale-version conflicts. **Inspect usage** reports library version references separately from scene assignments. V1 has no scene assignments, so that count is zero; it is not an inferred search through prose.

## Restricted Assistant Import

Configure an explicit local staging directory before starting the server:

```sh
export CYOA_ASSET_STAGING_DIR='/absolute/path/to/a/dedicated/staging-directory'
node apps/server/dist/main.js
```

Keep staging outside Git and put only files intended for import there. This is a server capability, disabled by default. The assistant's own authorized filesystem tools may place a supplied/generated image there; Creator does not expose a filesystem writer, image-generation provider or URL downloader.

The existing authenticated MCP endpoint exposes these nine additional tools (37 total):

| Tool | Boundary |
| --- | --- |
| `list_assets` | Title/description/tag search; 25 compact title/status/thumbnail summaries per page; full metadata in `read_asset` |
| `read_asset` | Exact image/metadata/provenance and retained approval; 20 history records per page |
| `asset_usage` | Exact library references, 25 per page, and actual assignment count |
| `list_staged_assets` | Regular image basenames, byte counts and SHA-256 only; no arbitrary paths |
| `import_staged_asset` | Exact staged basename/digest to unapproved candidate; explicit consent and operation UUID |
| `revise_asset` | Metadata candidate bound to exact current head |
| `review_asset` | Exact current candidate, retained approval, warnings/usage and locally calculated fingerprint |
| `approve_asset` | Explicit consent to exact candidate and review fingerprint |
| `reject_asset` | Explicit rejection of exact candidate and review fingerprint; prior approval retained |

Discover a staged file, then import it using its exact `sourceSha256`:

```json
{
  "projectId": "<configured-project-UUID>",
  "operationId": "<new-operation-UUID>",
  "approved": true,
  "filename": "harbor.png",
  "sourceSha256": "<digest-from-list_staged_assets>",
  "metadata": {
    "title": "Harbor",
    "description": "The harbor at dusk.",
    "altText": "A signal tower beside blue water.",
    "tags": ["harbor"],
    "credit": "<declared credit>",
    "license": "<declared license>"
  }
}
```

For replacement, also supply `assetId` and `expectedVersionId`. `approved: true` consents to this action, not approval of the candidate's content. Import reports `assistant-import`, never internal provider generation; it does not verify which generator produced a file.

Only a single basename ending in `.png`, `.jpg`, `.jpeg` or `.webp` is accepted. Absolute paths, path separators, symlinks, directories, devices and URLs are not accepted. An opened regular file is read with no-follow/nonblocking flags and a fixed byte bound, and its exact digest must match. Changing the staged file requires fresh discovery. Source files are not deleted or modified by import.

Reuse identical arguments and the same operation UUID after a lost response. Completed imports can replay even after the source file has disappeared. Changed arguments or reuse across connected editing/asset operations conflict. New imports after source loss require restoring the staged file, not inventing a success receipt.

## Storage And Validation

Image data is normalized through Sharp to oriented sRGB RGBA pixels and encoded as canonical PNG through PNGJS. Source EXIF and unknown PNG metadata chunks are not retained. Provenance retains the source basename, original SHA-256, detected MIME type and import kind, with zero provider calls. The stored content SHA-256 identifies normalized bytes, not the original uploaded encoding.

Images and thumbnails are content-addressed immutable `cyoa.image-file` v1 objects in SQLite's existing artifact storage. Base64 encoding keeps material inside the existing strictly validated portable-row format. A project stores identical bytes once; metadata/approval versions reference hashes without duplicating those bytes. No filesystem sidecar, machine path, new table or SQLite migration is required.

`cyoa.image-asset` v1 records retain candidate/approved/rejected history, exact previous versions and reviewed-candidate bindings. Generic artifact restore cannot promote an old image approval. Direct persistence writes, archive import and duplication validate the lifecycle chain, project ownership, file references, dimensions and canonical bytes. PNG integrity validation checks hashes, CRCs and bounded dimensions before decoding; imported material cannot merely claim a new hash for invalid bytes.

| Limit | Value |
| --- | --- |
| Uploaded/staged source | 8,000,000 bytes |
| Normalized PNG | 8,000,000 bytes |
| Dimension / total pixels | 4,096 per side / 8,000,000 pixels |
| Thumbnail | At most 256 per side / 512,000 bytes |
| Concurrent decoding | 2; additional attempts receive a retryable busy result |
| Project image material | 48,000,000 bytes, including retained history/thumbnail objects |
| Project library | 200 distinct assets / 2,000 charged lifecycle versions plus one current review outcome per asset (at most 2,200 total) |
| Staging catalogue | At most 2,000 directory entries / 500 eligible files |

The version budget charges every record except each asset's current approved/rejected head. This bounded completion allowance lets every pending candidate finish review, including existing projects at the former 2,000-record cap. Revising a reviewed head charges both its retained outcome and the new candidate; additional authoring is rejected when it would exceed 2,000 charged records. Approval/rejection preserves that charged count. Direct writes and archive validation use this same rule; no history is removed and no content/lineage checks are bypassed.

Animated and multi-page images, SVG/GIF, MIME mismatches, malformed/truncated inputs and oversized material are rejected before persistence. Resize/re-encode a rejected source within the limits and retry with a new binding when its bytes change. Budget errors retain existing history; use a smaller image for byte limits, finish pending reviews or use a separate project for version limits rather than discarding approved material. Failed content/receipt writes roll back together. Busy decoding can be retried with the same operation ID.

Browser image routes require loopback Host/IP and same-origin requests, reject cross-site requests, and serve only canonical `image/png` with `nosniff`, restrictive CSP and content-addressed URLs. MCP retains its bearer token, configured project allowlist and stricter no-browser-Origin boundary. Binary images never enter tool text results.

## Portability And Compatibility

Full-fidelity archives and verified backups include every candidate, approval, rejection, replacement, thumbnail and immutable file. Privacy-redacted archives retain authored descriptions/credits/provenance and image bytes but omit conversation operation receipts, consistently with the existing privacy policy. Full-fidelity restoration retains retry recovery; duplicated/redacted projects require fresh operation IDs and authorization.

Duplication gives records independent version identities while retaining project-scoped asset IDs and content hashes. The copied project's images remain usable after the original project is deleted. Missing, corrupt or mismatched material causes atomic import failure, not a partial project or falsely successful backup.

Historical archives without image artifacts remain supported. An older application that does not recognize these versioned image artifact types must reject them rather than silently discard material. Text-game compiler/runtime/save contracts remain unchanged. Unassigned library material is included in project archives, not injected into text-game publications.

Implementation references: [Sharp input limits](https://sharp.pixelplumbing.com/api-constructor/), [PNGJS strict decoding and encoding](https://github.com/pngjs/pngjs). Connected client setup remains project-scoped as described in [connected-editing.md](connected-editing.md).
