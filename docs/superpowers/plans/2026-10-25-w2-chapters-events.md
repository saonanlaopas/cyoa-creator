# W2 implementation plan

Authorized base: `7e977089cea561bbe4e69a8ec80731414b8339b0`. W2 only; independent acceptance remains separate from delivery.

Extend the existing world aggregate with an optional, explicitly versioned progression definition. Absence preserves W1/text bundle and save shapes. Chapter-free worlds use no chapters; events still work. Chapters have an authored initial chapter and explicit transitions. Events are player-triggered authored opportunities, not schedules or mandatory automatic encounters (W3).

Use bounded conjunctions of chapter, milestone, playable-location and absolute integer-time prerequisites. Events grant named milestones and support once, repeatable/cooldown, once-per-day and once-per-chapter rules. Transitions explicitly select retained milestones and permanently expired event IDs; other existing game state carries forward. A pure, fingerprint-bound preview names known lost opportunities and milestones before confirmation. Preview/cancel does not advance time or change saves.

The existing review/apply world operations, receipts, exact passage bindings, compiler projection and portable history paths remain shared by browser and MCP. Add a read-only transition preview tool. Reject contradictory requirements and invalid references at persistence/runtime boundaries; report bounded potential progression traps without an exhaustive-proof claim.

Implement domain/native schemas and deterministic runtime first, then compilation/save/history validation, shared services/MCP, Creator controls and player confirmation UI. Verify atomic rejection, replay rules, chapter-free play, expiry/carry, stale previews, malformed saves, exact historical compilation, retry/concurrency/rollback, backup/redaction/duplication and offline exports. Exercise actual Creator and standalone/static players on desktop/mobile. Preserve the accepted illustrated-scenes CSS and original assertion.

Run focused tests, lint/typecheck/build, full unit suite and matching Chromium full browser suite sequentially to avoid the previously observed concurrent-check timeouts. Commit as Codex, normal push, verify exact local/remote SHA equality and exact-head CI. Stop for independent review after W2 delivery.
