# Illustrated scenes (V2)

Creator's **Illustrated scenes** workspace and MCP tools `read_scene`,
`review_scene`, and `apply_scene` share the same service. A scene is presentation,
not a new game engine: accepted prose, authored choices, conditions, effects,
endings and saves still use the native player/runtime. No provider calls occur.

## Authoring and review

- Import/upload and approve images in the Asset library first.
- Select a passage, optional background, up to three positioned character
  portraits with explicit expressions, and up to twelve speaker/dialogue lines.
- Review the previous and proposed scenes, then explicitly approve and Apply.
  Changing a local field clears the review and consent. MCP Apply requires the
  exact locally computed review fingerprint, `approved: true`, and an operation UUID.
- Apply binds the current passage version and previous scene head. A concurrent
  Apply or passage edit invalidates the review. Read/review again to recover.
  An identical lost-response retry uses its original UUID and replays its durable
  receipt, even after restart or a full-fidelity backup/restore.
- Choose **Text** and Apply to clear artwork/dialogue. This also recovers from a
  missing image dependency without deleting the library or historical scenes.

Every applied `cyoa.illustrated-scene` v1 record is immutable, stored as artifact
type `illustrated-scene`, key `illustrated-scene:<passageId>`. Direct persistence
and archive validation check project/passage identity and exact approved image
versions. Generic restore is prohibited: restoring a scene requires new review.
No SQL migration or media sidecar is needed. Asset usage reports current scene
references in bounded pages, including stale passage bindings.

## Compilation and delivery

The existing native compilation-input v1 contract gains an optional, explicitly
versioned `illustrations` v1 extension, binding exact scene versions, content
fingerprints and the public presentation fingerprint. Native game-bundle v1 gains
optional `cyoa.illustrated-presentation` v1. Omission retains the original text
bundle fingerprint and save behavior. Strict older readers reject the unfamiliar
extension rather than silently dropping it. The runtime contract and save schema
are unchanged; existing installations/saves remain playable with their original
bundles. Save compatibility remains bound to an exact bundle, not artwork alone.

New compilation checks scene/passage freshness and validates canonical PNG bytes
and approved-image lineage. Replacing or rejecting a later library candidate
does not change pinned, previously approved artwork. To use a replacement, assign
that exact approved version and review/Apply again. Historical inputs/builds
always resolve their original imagery, dialogue and accepted prose.

Standalone HTML and static ZIP embed only selected canonical PNGs, alternative
text, credit/license, scene layout/dialogue and existing public game content.
Images are deduplicated by approved version. No source filenames, import prompts,
operation receipts, transcripts, staging paths, provider keys or authoring service
are required for playback. The existing 64,000,000-byte bundle budget (including
encoded images/prose) and 200 packaged-image-version limit remain enforced; use
smaller artwork or remove optional assignments and recompile if exceeded.

Backgrounds are contained, portraits have explicit left/center/right positions,
and dialogue/choice controls are real accessible HTML, never baked into art.
Native Tab/Enter controls, focus, save/load/rewind and responsive text remain.
Missing optional assignments show text; failed image rendering exposes alternative
text without blocking choices. Accepted prose remains visible alongside dialogue.

Markdown and Twee/SugarCube reject illustrated builds with capability diagnostics;
use native HTML/ZIP instead. Full and privacy-redacted project archives retain
scene/image history and exact historical builds. Privacy redaction may reseal
authoring input references but preserves playable fingerprints/presentation.
Duplication remaps version identities and reseals compilation/build references.

No world/map/exploration/inventory/time/NPC mechanics or paid generation are part
of V2. The procedural harbor and portrait images in tests are original offline
fixtures, not claims of model-generated or production-quality illustration.
