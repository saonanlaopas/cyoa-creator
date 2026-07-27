import { useMemo, useState } from "react";
import type { GameplayProject, GameplayEffect } from "../../api/quick-generation.js";

export type { GameplayEffect, GameplayProject };

export function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function relationshipLabel(definition: GameplayProject["mechanics"]["relationships"][string], value: number): string {
  return [...definition.bands].sort((a, b) => b.min - a.min).find((band) => value >= band.min)?.label ?? definition.label;
}

export function Player({ project }: { project: GameplayProject }) {
  const passageMap = useMemo(() => new Map(project.passages.map((passage) => [passage.id, passage])), [project]);
  const initialStats = () => Object.fromEntries(Object.entries(project.mechanics.visibleStats).map(([key, value]) => [key, value.initial]));
  const initialRelationships = () => Object.fromEntries(Object.entries(project.mechanics.relationships).map(([key, value]) => [key, value.initial]));
  const [passageId, setPassageId] = useState(project.startPassageId);
  const [stats, setStats] = useState<Record<string, number>>(initialStats);
  const [relationships, setRelationships] = useState<Record<string, number>>(initialRelationships);
  const passage = passageMap.get(passageId);

  const choose = (choice: GameplayProject["passages"][number]["choices"][number]) => {
    for (const effect of choice.effects) {
      if (effect.op === "addStat") setStats((current) => ({ ...current, [effect.key]: (current[effect.key] ?? 0) + effect.value }));
      if (effect.op === "addRelationship") setRelationships((current) => ({ ...current, [effect.key]: (current[effect.key] ?? 0) + effect.value }));
    }
    setPassageId(choice.destinationId);
  };
  const restart = () => {
    setStats(initialStats());
    setRelationships(initialRelationships());
    setPassageId(project.startPassageId);
  };

  if (!passage) return <p>Missing passage: {passageId}</p>;
  return <div className="player">
    <aside className="stats">
      <h3>Story state</h3>
      {Object.entries(project.mechanics.visibleStats).map(([key, value]) => <div key={key}>{value.label}: {stats[key] ?? 0}</div>)}
      {Object.entries(project.mechanics.relationships).map(([key, value]) => <div key={key}>{value.label}: {relationshipLabel(value, relationships[key] ?? 0)}</div>)}
      <button onClick={restart}>Restart</button>
    </aside>
    <article>
      <p className="eyebrow">{project.name}</p>
      <h2>{passage.title}</h2>
      {passage.prose.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      <div className="choices">
        {passage.choices.map((choice) => <button key={choice.id} onClick={() => choose(choice)}>{choice.label}</button>)}
      </div>
      {passage.ending && <p className="ending">Ending: {passage.ending}</p>}
    </article>
  </div>;
}
