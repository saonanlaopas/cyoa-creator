# Foundation 8A recovery threat model and change map

## Accepted base and boundary

- Base: `3733ea20dde00902eb09deff90ee3d611371b032`.
- Foundation 7 remains the authority for `cyoa.portable-project/v1`, native compilation, browser play, and `cyoa.native-player-save/v1`.
- Foundation 8A adds recovery verification and compatibility around those contracts. It does not add a second project serialization model, cloud storage, provider work, performance optimization, summaries, or pinned decisions.

## Recovery assets and trust boundaries

1. Canonical authoring SQLite data is trusted only after normal migration, foreign-key enforcement, and domain validation.
2. Portable archives, project-backup files, browser uploads, migration fixtures, and player saves are untrusted input.
3. `cyoa.portable-project/v1` remains the exact project-content payload. A backup wraps those unchanged bytes with a strict `cyoa.project-backup-record/v1` verification record.
4. Backup ZIP bodies are returned to the browser and are not stored in SQLite. SQLite stores bounded immutable identity, hash, semantic fingerprint, verification, and restore metadata only.
5. Browser-local player saves remain separate from authoring-project backups.
6. A raw operational SQLite copy is deferred: the current user-facing semantic guarantee is the verified portable backup. Naive copying of an active WAL database is forbidden; a future operational-copy feature must use SQLite's backup API or an equivalent consistency-safe mechanism.

## Primary threats and required defenses

| Threat | Defense |
| --- | --- |
| Archive traversal, symlink, encryption, decompression bomb, duplicate entry, oversized content | Reuse portable limits and hostile ZIP inspection; require the exact bounded backup entry set. |
| Forged or tampered backup metadata | Strict schema and exact-key parsing; hash/byte-count/project-fingerprint cross-check against the embedded portable archive. |
| A technically importable archive with changed semantic meaning | Isolated temporary database import, exhaustive portable/domain validation, canonical re-export, byte/hash and semantic-fingerprint comparison before `verified`. |
| Verification mutates the live project | Capture portable bytes synchronously, verify only in a unique temporary database, and persist only excluded recovery metadata after verification. |
| Concurrent edit creates a mixed backup | Capture is synchronous and immutable; later edits change current freshness but do not relabel the captured backup. |
| Concurrent verification shares state or cleanup | `mkdtemp` creates unique directories; each operation owns and cleans only its directory in `finally`. |
| Preview data is replayed as authority | Preview is write-free; restore re-uploads, reparses, revalidates, and independently verifies authoritative bytes. |
| Restore overwrites an existing project | Preserve portable stable identity; reject collisions in the server transaction; never rewrite project/entity IDs. |
| Partial restore survives | Parse and isolate-verify before mutation; import, exhaustive validation, semantic comparison, backup record, and restore record complete in one `BEGIN IMMEDIATE` transaction. |
| Corrupt/future database is replaced by an empty database | Classify existing files before migration; reject corruption and future versions; close without resetting, deleting, truncating, or recreating the source path. |
| Migration partially installs v16 | Additive v16 migration in one transaction; validate schema/version state; frozen-v15 conflict/corruption regression proves rollback. |
| Backup reminder lies | Compare the latest verified captured semantic fingerprint and source schema/application identity with current exact portable meaning; timestamps never determine factual freshness. |
| Destructive deletion hides recovery risk | Recompute backup freshness server-side, require exact project/fingerprint confirmation, show the factual state, permit cancellation, and never auto-create a backup. |
| Provider outage blocks recovery | Recovery services have no provider dependency; tests assert no provider endpoint/request is used. |

## Change map

- `packages/domain`: strict backup/restore record contracts and bounded status types.
- `packages/persistence`: v16 recovery metadata tables, repository, schema inventory, database preflight/integrity diagnostics, migration and fixture matrix, and explicit permanent project deletion.
- `apps/server`: verified-backup and restore service, thin bounded upload/download/status/integrity/delete routes, portable parser reuse, startup diagnostics, and recovery tests.
- `apps/web`: Backup & Recovery workspace, global restore entry when no project is open, accurate verification/download language, collision-safe preview, accessible destructive confirmation, and API client.
- `docs/user-guide.md`: recovery guarantees, reminders, restore/collision behavior, startup safety, browser-save boundary, and operational-copy limitation.
- Roadmap: only the 8A implementation status line changes after acceptance-gate verification.

## Migration inventory

The supported frozen-fixture boundary is schema v4 through v15. Versions v4-v14 are already frozen and hash-checked. Foundation 8A freezes the accepted v15 state before adding v16.

| Version | Foundation/checkpoint | Frozen fixture | Forward route |
| --- | --- | --- | --- |
| 4 | Foundations 1-3 baseline | `schema-v4.sqlite` | v4 -> ... -> v16 |
| 5 | 4A generation kernel | `schema-v5.sqlite` | v5 -> ... -> v16 |
| 6 | 4A job/unit lineage | `schema-v6.sqlite` | v6 -> ... -> v16 |
| 7 | 4A generation candidates | `schema-v7.sqlite` | v7 -> ... -> v16 |
| 8 | 4A candidate lineage | `schema-v8.sqlite` | v8 -> ... -> v16 |
| 9 | 4A proposal application | `schema-v9.sqlite` | v9 -> ... -> v16 |
| 10 | 4B draft architecture | `schema-v10.sqlite` | v10 -> ... -> v16 |
| 11 | 4B draft provenance | `schema-v11.sqlite` | v11 -> ... -> v16 |
| 12 | 4B generated draft outputs | `schema-v12.sqlite` | v12 -> ... -> v16 |
| 13 | 4B draft acceptance | `schema-v13.sqlite` | v13 -> ... -> v16 |
| 14 | Foundation 6 repair applications | `schema-v14.sqlite` | v14 -> v15 -> v16 |
| 15 | Foundation 6 repair-draft provenance | `schema-v15.sqlite` | v15 -> v16 |
| 16 | Foundation 8A recovery metadata | current schema after 8A | current |

Schemas earlier than the earliest accepted frozen v4 fixture are not claimed as supported historical recovery inputs. New empty databases still bootstrap normally through the current schema.

## Completion invariants

- `verified` is impossible before isolated restore and exact semantic comparison succeed.
- Failed verification records no verified row and changes no canonical authoring state.
- Historical verification and current backup coverage are separate facts.
- Restore preview performs zero canonical writes.
- Restore is collision-safe and atomic; the restored project immediately uses ordinary repositories and workflows.
- Existing corrupt, future-schema, read-only, or failed-migration database files are never silently replaced.
- Every supported frozen fixture migrates from a temporary copy, passes integrity/read checks, and remains byte-identical at its original path.
- Unicode-heavy 300-passage recovery preserves exact prose and structure and can compile and play afterward.
- All recovery work is offline and provider-independent.
