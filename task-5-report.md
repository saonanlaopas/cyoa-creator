# Task 5 report — command and draft-project APIs

Base HEAD: `984076341d90da1540870fb1902e6874427b6fa0`

## Delivered

- `POST /api/quick/drafts` creates a persisted `Untitled adaptation` project and returns `{ projectId, name }`.
- Global command CRUD is available at `/api/commands/global`.
- Project command CRUD, effective-command listing, and project-to-global copy promotion are available under `/api/projects/:projectId/commands`.
- Routes validate command bodies with deterministic 400 responses; missing projects and missing/cross-project command IDs return deterministic 404 responses.
- App construction creates one shared `CommandRepository` and supplies it to the command routes.

## TDD evidence

- RED count: 1 focused behavior run. `apps/server/test/commands.test.ts` had 7 expected failures, all caused by route-not-found 404 responses before registration.
- GREEN count: 1 immediate focused behavior run. The same file then passed 7/7 after the implementation.
- Follow-up green verification: command/project route tests passed 9/9; the full suite passed 81/81.

## Verification

- `vitest apps/server/test/commands.test.ts apps/server/test/projects.test.ts --run` — 9/9 passed.
- `pnpm --filter @story-to-cyoa/server typecheck` — passed.
- `pnpm test` — 25 files and 81 tests passed.

## Concerns

- Vitest reports its existing workspace-file deprecation and Node reports its existing experimental SQLite warning. Neither is caused by Task 5.
- The normal sandbox prevents Vitest/esbuild from traversing this worktree; verification was rerun with the required elevated test permission.
