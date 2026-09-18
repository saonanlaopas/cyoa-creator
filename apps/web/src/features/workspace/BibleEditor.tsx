import { useEffect, useState } from "react";
import type {
  BibleCharacter,
  BibleRelationship,
  BibleSectionEntry,
  LongFormStoryBible,
} from "../../api/long-form.js";

const lines = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function BibleEditor(props: {
  bible: LongFormStoryBible;
  busy: boolean;
  presentationOwnedByCreativeDirection?: boolean;
  onSave(bible: LongFormStoryBible): Promise<void>;
}) {
  const [draft, setDraft] = useState(props.bible);
  useEffect(() => setDraft(props.bible), [props.bible]);

  return <form className="brief-editor bible-editor" onSubmit={(event) => {
    event.preventDefault();
    void props.onSave(draft);
  }}>
    <section className="brief-section">
      <h3>Bible overview</h3>
      <label>Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required /></label>
      <label>Story overview<textarea value={draft.overview} onChange={(event) => setDraft({ ...draft, overview: event.target.value })} /></label>
    </section>

    <section className="brief-section">
      <SectionHeading title="Characters" onAdd={() => setDraft({
        ...draft,
        characters: [...draft.characters, {
          id: id("character"), name: "", role: "", summary: "", motivations: [], knowledge: [], plannedArc: "",
        }],
      })} />
      {draft.characters.length === 0 && <p className="field-note">Add the major cast and what each person knows, wants, and may become.</p>}
      {draft.characters.map((character, index) => <CharacterCard
        key={character.id}
        character={character}
        onChange={(next) => setDraft({
          ...draft,
          characters: draft.characters.map((item, itemIndex) => itemIndex === index ? next : item),
        })}
        onRemove={() => setDraft({ ...draft, characters: draft.characters.filter((_, itemIndex) => itemIndex !== index) })}
      />)}
    </section>

    <section className="brief-section">
      <SectionHeading title="Relationships" onAdd={() => setDraft({
        ...draft,
        relationships: [...draft.relationships, {
          id: id("relationship"), characterIds: [], label: "", currentState: "", plannedArc: "",
        }],
      })} />
      {draft.relationships.map((relationship, index) => <RelationshipCard
        key={relationship.id}
        relationship={relationship}
        characters={draft.characters}
        onChange={(next) => setDraft({
          ...draft,
          relationships: draft.relationships.map((item, itemIndex) => itemIndex === index ? next : item),
        })}
        onRemove={() => setDraft({ ...draft, relationships: draft.relationships.filter((_, itemIndex) => itemIndex !== index) })}
      />)}
      {draft.relationships.length === 0 && <p className="field-note">Relationships will later drive route gates, stat bands, and ending consequences.</p>}
    </section>

    {([
      ["settings", "Settings and institutions"],
      ["timeline", "Timeline and causality"],
      ["worldRules", "World rules"],
      ["themes", "Themes"],
    ] as const).map(([key, title]) => <EntrySection
      key={key}
      title={title}
      entries={draft[key]}
      onChange={(entries) => setDraft({ ...draft, [key]: entries })}
    />)}

    <section className="brief-section">
      <h3>Legacy prose guidance</h3>
      {props.presentationOwnedByCreativeDirection && <p className="field-note">Creative Direction is authoritative for new presentation contexts. This historical Bible guidance remains readable and unchanged.</p>}
      <label>Point of view<input disabled={props.presentationOwnedByCreativeDirection} value={draft.proseGuidance.pointOfView} onChange={(event) => setDraft({
        ...draft,
        proseGuidance: { ...draft.proseGuidance, pointOfView: event.target.value },
      })} /></label>
      <div className="brief-grid">
        <LinesField disabled={props.presentationOwnedByCreativeDirection} label="Tone" value={draft.proseGuidance.tone} onChange={(tone) => setDraft({
          ...draft, proseGuidance: { ...draft.proseGuidance, tone },
        })} />
        <LinesField disabled={props.presentationOwnedByCreativeDirection} label="Style rules" value={draft.proseGuidance.style} onChange={(style) => setDraft({
          ...draft, proseGuidance: { ...draft.proseGuidance, style },
        })} />
      </div>
      <LinesField disabled={props.presentationOwnedByCreativeDirection} label="Avoid" value={draft.proseGuidance.avoid} onChange={(avoid) => setDraft({
        ...draft, proseGuidance: { ...draft.proseGuidance, avoid },
      })} />
    </section>

    <section className="brief-section">
      <SectionHeading title="Canon facts" onAdd={() => setDraft({
        ...draft,
        canonFacts: [...draft.canonFacts, {
          id: id("fact"), statement: "", sourceExcerptIds: [], confidence: "confirmed",
        }],
      })} />
      {draft.canonFacts.map((fact, index) => <article className="bible-card" key={fact.id}>
        <label>Statement<textarea value={fact.statement} onChange={(event) => setDraft({
          ...draft,
          canonFacts: draft.canonFacts.map((item, itemIndex) =>
            itemIndex === index ? { ...item, statement: event.target.value } : item),
        })} required /></label>
        <div className="brief-grid">
          <label>Confidence<select value={fact.confidence} onChange={(event) => setDraft({
            ...draft,
            canonFacts: draft.canonFacts.map((item, itemIndex) =>
              itemIndex === index ? { ...item, confidence: event.target.value as typeof fact.confidence } : item),
          })}>
            <option value="confirmed">Confirmed</option>
            <option value="likely">Likely</option>
            <option value="uncertain">Uncertain</option>
          </select></label>
          <label>Source excerpt IDs <span>One per line</span><textarea value={fact.sourceExcerptIds.join("\n")} onChange={(event) => setDraft({
            ...draft,
            canonFacts: draft.canonFacts.map((item, itemIndex) =>
              itemIndex === index ? { ...item, sourceExcerptIds: lines(event.target.value) } : item),
          })} /></label>
        </div>
        <RemoveButton onClick={() => setDraft({ ...draft, canonFacts: draft.canonFacts.filter((_, itemIndex) => itemIndex !== index) })} />
      </article>)}
    </section>

    <PairSection
      title="Contradictions"
      firstLabel="Contradiction"
      secondLabel="Resolution"
      items={draft.contradictions}
      firstKey="description"
      secondKey="resolution"
      onChange={(contradictions) => setDraft({ ...draft, contradictions })}
      prefix="contradiction"
    />
    <PairSection
      title="Adaptation opportunities"
      firstLabel="Opportunity"
      secondLabel="Rationale"
      items={draft.adaptationOpportunities}
      firstKey="description"
      secondKey="rationale"
      onChange={(adaptationOpportunities) => setDraft({ ...draft, adaptationOpportunities })}
      prefix="opportunity"
    />
    <PairSection
      title="Unresolved questions"
      firstLabel="Question"
      secondLabel="Answer or decision"
      items={draft.unresolvedQuestions}
      firstKey="question"
      secondKey="answer"
      onChange={(unresolvedQuestions) => setDraft({ ...draft, unresolvedQuestions })}
      prefix="question"
    />

    <div className="brief-actions">
      <button className="primary" disabled={props.busy}>{props.busy ? "Saving…" : "Save bible draft"}</button>
    </div>
  </form>;
}

function SectionHeading(props: { title: string; onAdd(): void }) {
  return <header className="bible-section-heading">
    <h3>{props.title}</h3>
    <button type="button" onClick={props.onAdd}>Add {props.title.toLowerCase()}</button>
  </header>;
}

function RemoveButton(props: { onClick(): void }) {
  return <button type="button" className="danger-text" onClick={props.onClick}>Remove</button>;
}

function LinesField(props: { label: string; value: string[]; disabled?: boolean; onChange(value: string[]): void }) {
  return <label>{props.label} <span>One per line</span>
    <textarea disabled={props.disabled} value={props.value.join("\n")} onChange={(event) => props.onChange(lines(event.target.value))} />
  </label>;
}

function CharacterCard(props: {
  character: BibleCharacter;
  onChange(value: BibleCharacter): void;
  onRemove(): void;
}) {
  const update = <K extends keyof BibleCharacter>(key: K, value: BibleCharacter[K]) =>
    props.onChange({ ...props.character, [key]: value });
  return <article className="bible-card">
    <div className="brief-grid">
      <label>Name<input value={props.character.name} onChange={(event) => update("name", event.target.value)} required /></label>
      <label>Role<input value={props.character.role} onChange={(event) => update("role", event.target.value)} /></label>
    </div>
    <label>Summary<textarea value={props.character.summary} onChange={(event) => update("summary", event.target.value)} /></label>
    <div className="brief-grid">
      <LinesField label="Motivations" value={props.character.motivations} onChange={(value) => update("motivations", value)} />
      <LinesField label="Knowledge" value={props.character.knowledge} onChange={(value) => update("knowledge", value)} />
    </div>
    <label>Planned arc<textarea value={props.character.plannedArc} onChange={(event) => update("plannedArc", event.target.value)} /></label>
    <RemoveButton onClick={props.onRemove} />
  </article>;
}

function RelationshipCard(props: {
  relationship: BibleRelationship;
  characters: BibleCharacter[];
  onChange(value: BibleRelationship): void;
  onRemove(): void;
}) {
  const update = <K extends keyof BibleRelationship>(key: K, value: BibleRelationship[K]) =>
    props.onChange({ ...props.relationship, [key]: value });
  return <article className="bible-card">
    <div className="brief-grid">
      <label>Label<input value={props.relationship.label} onChange={(event) => update("label", event.target.value)} /></label>
      <label>Character IDs <span>At least two, one per line</span><textarea
        value={props.relationship.characterIds.join("\n")}
        onChange={(event) => update("characterIds", lines(event.target.value))}
        placeholder={props.characters.map((character) => `${character.id} (${character.name})`).join("\n")}
        required
      /></label>
    </div>
    <label>Current state<textarea value={props.relationship.currentState} onChange={(event) => update("currentState", event.target.value)} /></label>
    <label>Planned arc<textarea value={props.relationship.plannedArc} onChange={(event) => update("plannedArc", event.target.value)} /></label>
    <RemoveButton onClick={props.onRemove} />
  </article>;
}

function EntrySection(props: {
  title: string;
  entries: BibleSectionEntry[];
  onChange(entries: BibleSectionEntry[]): void;
}) {
  return <section className="brief-section">
    <SectionHeading title={props.title} onAdd={() => props.onChange([
      ...props.entries, { id: id("entry"), label: "", description: "" },
    ])} />
    {props.entries.map((entry, index) => <article className="bible-card" key={entry.id}>
      <label>Label<input value={entry.label} onChange={(event) => props.onChange(
        props.entries.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item),
      )} required /></label>
      <label>Description<textarea value={entry.description} onChange={(event) => props.onChange(
        props.entries.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item),
      )} /></label>
      <RemoveButton onClick={() => props.onChange(props.entries.filter((_, itemIndex) => itemIndex !== index))} />
    </article>)}
  </section>;
}

function PairSection<
  T extends { id: string },
  First extends keyof T,
  Second extends keyof T,
>(props: {
  title: string;
  firstLabel: string;
  secondLabel: string;
  items: T[];
  firstKey: First;
  secondKey: Second;
  onChange(items: T[]): void;
  prefix: string;
}) {
  const blank = { id: id(props.prefix), [props.firstKey]: "", [props.secondKey]: "" } as unknown as T;
  return <section className="brief-section">
    <SectionHeading title={props.title} onAdd={() => props.onChange([...props.items, blank])} />
    {props.items.map((item, index) => <article className="bible-card" key={item.id}>
      <label>{props.firstLabel}<textarea value={String(item[props.firstKey])} onChange={(event) => props.onChange(
        props.items.map((value, itemIndex) =>
          itemIndex === index ? { ...value, [props.firstKey]: event.target.value } : value),
      )} required /></label>
      <label>{props.secondLabel}<textarea value={String(item[props.secondKey])} onChange={(event) => props.onChange(
        props.items.map((value, itemIndex) =>
          itemIndex === index ? { ...value, [props.secondKey]: event.target.value } : value),
      )} /></label>
      <RemoveButton onClick={() => props.onChange(props.items.filter((_, itemIndex) => itemIndex !== index))} />
    </article>)}
  </section>;
}
