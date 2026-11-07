## PF-001 — Foundation root becomes uneditable after content growth

- Severity: high for long-form maintainability; currently non-blocking for the first playable opening.
- Error: `edit_context_overflow_narrow_scope`.
- What happens: `prepare_edit` must include the selected target, retained author context, and effective authoring instructions within a 64 KB context ceiling. The `bible:root` and `routes:root` targets contain their entire artifacts. Once those artifacts grow, root-scoped preparation fails before a plan is created.
- Why it matters: existing nested entities remain editable through narrow targets, but adding new items to a top-level array requires an `add-item` operation against the root. That operation becomes unreachable through the supported conversational workflow after the root grows large.
- Bible reproduction: project head `316aa7a1ee3ef655934eb16728ee53a84d0d1f763386b3ee21620dd435ac81f4`; Bible version `f53dec5c-09bd-4958-b935-cf8a7ca55b37`; prepare operation `31130238-9d25-4924-a2a0-c758e3165969`; target `bible:root`; result `edit_context_overflow_narrow_scope` before plan creation.
- Route reproduction: project head `39f385fe8c3dc2929380be472fe638ee3d094701f4d410b541178333c375fce2`; route version `3a10a890-e2a4-441a-9a95-9c81c6636a20`; prepare operation `eda642a2-e803-4d71-887b-b99526db0e83`; targets included `routes:root`, the route-selection decision, and seven ending hooks; result `edit_context_overflow_narrow_scope` before plan creation.
- Atomicity/data safety: good. Both failures produced zero proposals, zero provider calls, and zero canonical mutations.
- Current trial impact: ten high-level opening decision records could not be added to the route foundation. They will instead be implemented in the canonical passage/choice layer, which is the correct runtime layer and supports conditions/effects. The route foundation itself remains valid.
- Product direction to consider: collection-level edit targets for top-level arrays; a slimmer root target; context budgeting that omits unrelated root fields; or supported author-memory compaction/new-conversation control.
