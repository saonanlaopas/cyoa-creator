# New-project handoff

## Setup checklist

1. Create a separate Story Creator directory and Git repository.
2. Copy the complete `story-creator-planning` folder into it.
3. Add a short root README that points to the planning package.
4. Add an appropriate `.gitignore` and make an explicit license decision.
5. Commit the planning package before copying or writing application code.
6. Give the implementing Codex task both the new repository path and the local path or commit for Story-to-CYOA.
7. Begin with Foundation 1 only. Copy later infrastructure when its foundation requires it.

## Initial implementation prompt

Copy and adjust the two absolute paths before using this prompt:

> Implement Foundation 1 of Story Creator from the committed planning package in `<NEW_STORY_CREATOR_REPOSITORY>`.
>
> Before changing anything, read every document in `story-creator-planning`, inspect the current repository state, and inspect the reusable Story-to-CYOA source at `<CYOA_REPOSITORY>` using `story-creator-planning/06-cyoa-reuse-map.md` as the boundary. Tell me what you find before making changes. Do not turn the existing CYOA application into Story Creator; this is a separate product and repository.
>
> Work directly in the current checkout without subagents. Use a light workflow: make a short plan, implement the foundation, run focused tests, update the user guide and relevant planning documentation, review the finished foundation once, and commit the completed checkpoint. Do not create repeated review/fix loops unless a concrete failure requires one.
>
> Preserve the planning package's requirements for immutable imported sources, stable IDs, artifact versions and approval, history/comparison/restore, transactional writes, recoverable persistence, and portable project archives. Keep the application fully usable without an AI provider.
>
> Use only deterministic offline fixtures and fake providers during development. Do not make paid or live OpenRouter requests. Ask before any major product tradeoff, destructive action, public publishing action, or external authorization. If interrupted or nearing a limit, commit any coherent completed slice and add a concise continuation note with completed work, remaining work, verification status, and the next concrete step.

## Later-foundation prompt template

> Implement Foundation `<N>` of Story Creator from the committed roadmap. Work directly in the current checkout without subagents.
>
> First inspect the repository, all planning documents relevant to this foundation, the prior foundation's acceptance evidence, and any continuation note. Do not redo completed work. Tell me the current state before changing anything.
>
> Implement the foundation completely, run focused offline tests, update the user guide and relevant planning documentation, review the finished foundation once, and commit it as a separate checkpoint. Do not begin the next foundation in this task.
>
> Preserve existing behavior and the product contracts for immutable sources, stable-ID operations, approval and version history, transactional proposal application, bounded context, privacy, resumable jobs, checkpoints, and recovery. Interrupted, malformed, cancelled, or stale AI responses must not mutate canonical artifacts.
>
> Use deterministic offline fake providers and make no paid or live OpenRouter requests. Ask before a major product tradeoff, destructive action, or required external authorization. If interrupted or nearing a limit, commit any coherent completed slice and leave a concise continuation note in the repository.

## Continuation note template

Use `docs/continuation.md` only when a checkpoint cannot be completed in one task. Remove it after the next task has incorporated the note and completed the checkpoint.

```markdown
# Continuation: Foundation N

## Completed

- ...

## Remaining

- ...

## Verification

- Passed: ...
- Not yet run: ...
- Known failure: ...

## Repository state

- Branch: ...
- Latest coherent commit: ...
- Intentional uncommitted files: ...

## Next concrete step

...
```

## Settled requirements to preserve

- The product supports premise-first creation, import-and-mend, and import-and-continue.
- A user may provide only a premise and ask AI to suggest the complete first planning pass.
- The guided workflow remains visible and canonical even when chat is used frequently.
- Chat is a persistent assistant, not a separate source of truth.
- Scope is always visible and manually adjustable.
- Discussion cannot mutate artifacts; changes arrive as structured proposals for review.
- Large proposals use summaries, grouped diffs, dependency-aware selective acceptance, and one transactional apply.
- Imported source text remains immutable and available as evidence.
- AI work is bounded, resumable, checkpointed, and safe under malformed or interrupted output.
- Provider activity may be visible in a bounded scrollable component; raw private reasoning is withheld and is not persistent assistant memory.
- The application is local-first and exportable. Provider credentials are encrypted and excluded from projects, exports, logs, and prompts.
- Engineering and automated verification do not require paid OpenRouter calls.

## Suggested first conversation in the new repository

After the planning package is committed, use the initial implementation prompt above. Avoid asking for multiple foundations at once until the core domain and persistence behavior have passed Foundation 1's acceptance gate; those contracts constrain every later AI and editing workflow.
