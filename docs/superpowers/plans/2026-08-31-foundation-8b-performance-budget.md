# Foundation 8B performance and health budget

## Scope and method

This checkpoint measures deterministic, offline authoring paths. It uses the
existing approximately 300-passage linear Unicode fixture, which has 299
choices, approved planning dependencies, 300 accepted immutable drafts, and
the normal publication path. The broader native-compilation recovery fixture
adds a revised Unicode draft, immutable history, an export, backup, restore,
and replay. A second, deliberately small history-heavy fixture keeps passage
and draft versions, accepted/reviewed/locked and stale state, jobs and
attempts, simulation, playtest, narrative review, repair
plan/proposal/application, native publication, verified backup/restore, and
usage evidence together in one restored project. It executes no provider.
These are test fixtures, not background telemetry.

Wall-clock observations are diagnostic only because the fixture setup and
SQLite/CI machine variance dominate short operations. The 300-passage health
and native compilation assertion completed in 2.51 seconds on the local
offline test runner. CI enforces the structural contracts below instead of a
fragile time threshold.

## Measured baseline and decisions

- Passage-plan and draft-queue list records already contain metadata, stable
  IDs, lifecycle state, and word counts, not prose bodies. The 300-passage API
  regression confirms the passage-plan response contains no `proseMarkdown`.
- Native compilation and simulation previously called `getHead` for every
  passage. Each call mapped draft provenance and related immutable rows, an
  avoidable N+1 traversal at 300 passages.
- The current production Vite build reports a large authoring bundle warning
  (about 604 KB before this checkpoint). No route split was introduced because
  the measured hot path was database work and this checkpoint did not establish
  a separate startup/load benefit that would justify changing deterministic
  offline asset loading.
- The review queue is semantically compact and scroll-bounded. No virtualization
  was added: the 300-item target remains practical and changing keyboard/focus
  behavior without a measured render excess would add risk without evidence.
- No index or schema migration was added. SQLite's existing primary/foreign-key
  access paths cover the measured bulk lookup; the health endpoint exposes an
  `EXPLAIN QUERY PLAN` diagnostic for its compact passage metadata query.
- The history-heavy fixture measured these serialized metadata responses on
  the local offline runner: passage plan 38,579 bytes; draft queue 9,718;
  simulation list 521; playtest list 759; narrative list 21,229; repair plans
  690; repair proposals 13,440; repair applications 4,198; publication builds
  1,174; recovery status 4,004; Project Health 3,447; usage report 1,464. Its
  prose, simulation steps/findings, playtest samples, and other heavy bodies
  remained available only through detail endpoints.

## Enforced structural budgets

| Surface | Contract |
| --- | --- |
| Project health | At most 96,000 serialized response bytes; no prose, prompts, author notes, provider responses, credentials, or local paths. |
| Health history metadata | At most 100 latest repair records. Full evidence remains detail-only. |
| Usage groups | At most 100 groups; a truthful truncation flag is returned if more exist. |
| Accepted draft lookup | One bounded passage-ID query plus four set-based related-row queries; it never walks unrelated draft history. |
| Publication and simulation | Reuse the bulk accepted-head projection for every passage in the exact snapshot rather than one `getHead` call per passage. |
| Storage diagnostics | Counts and file/WAL sizes only. No automatic cleanup, deletion, quota guess, raw filesystem path, or browser-local-save claim. |
| Freshness/readiness | Passage-plan validation is `current`, `historical-approved`, `not-evaluated`, or `invalid`; malformed or absent evidence never becomes zero findings. Health marks publication readiness and backup freshness as `not-evaluated`; those potentially heavy authoritative checks remain explicit in their own workspaces. |
| Usage/cost | Attempts and provider requests are distinct. Exact repair evidence counts generation plus repair requests; incomplete historical request evidence is `partial` or `unknown`. Unit rollups and candidate mirrors are excluded. Missing historical cost remains unknown; no estimates or repricing occur. |

## Remaining ceiling and follow-up

Foundation 8B establishes bounded diagnostics and removes the demonstrated
accepted-draft N+1 path. It does not claim that every historical list has been
virtualized or that an arbitrary corpus is unboundedly fast. Foundation 8C
owns long-session ergonomics, accessibility, and any additional measured
large-list or startup optimizations.
