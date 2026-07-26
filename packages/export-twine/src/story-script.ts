export const storyScript = String.raw`
setup.storyToCyoA = {
  condition(state, condition) {
    if (condition.kind === "statAtLeast") return (state.stats[condition.key] || 0) >= condition.value;
    if (condition.kind === "flagEquals") return state.flags[condition.key] === condition.value;
    if (condition.kind === "hasItem") return state.inventory.includes(condition.itemId);
    if (condition.kind === "relationshipAtLeast") return (state.relationships[condition.key] || 0) >= condition.value;
    return false;
  },
  conditions(state, conditions) {
    return conditions.every((condition) => this.condition(state, condition));
  },
  immediate(state, effect) {
    if (effect.op === "addStat") state.stats[effect.key] = (state.stats[effect.key] || 0) + effect.value;
    if (effect.op === "setFlag") state.flags[effect.key] = effect.value;
    if (effect.op === "addRelationship") state.relationships[effect.key] = (state.relationships[effect.key] || 0) + effect.value;
    if (effect.op === "addItem" && !state.inventory.includes(effect.itemId)) state.inventory.push(effect.itemId);
    if (effect.op === "removeItem") state.inventory = state.inventory.filter((id) => id !== effect.itemId);
  },
  applyEffects(state, effects) {
    const due = [];
    state.pendingEffects = state.pendingEffects.filter((pending) => {
      pending.remaining -= 1;
      if (pending.remaining <= 0) due.push(pending.effect);
      return pending.remaining > 0;
    });
    due.forEach((effect) => this.immediate(state, effect));
    effects.forEach((effect) => {
      if (effect.delay) state.pendingEffects.push({
        remaining: effect.delay === "nextPassage" ? 1 : effect.delay,
        effect: Object.assign({}, effect, { delay: undefined })
      });
      else this.immediate(state, effect);
    });
    State.variables.inventory = state.inventory;
  },
  relationshipLabel(definition, value) {
    return definition.bands.slice().sort((a, b) => b.min - a.min).find((band) => value >= band.min)?.label || definition.label;
  }
};
`;
