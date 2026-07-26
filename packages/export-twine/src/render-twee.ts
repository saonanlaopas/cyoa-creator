import { createHash } from "node:crypto";
import { ProjectSchema, type Project } from "@story-to-cyoa/domain";
import { escapeTweeText, passageNameMap } from "./escape.js";
import { storyScript } from "./story-script.js";

export interface PlayableStoryData {
  title: string;
  startPassageId: string;
  passages: Array<{
    id: string;
    title: string;
    prose: string;
    ending: string | null;
    choices: Project["passages"][number]["choices"];
  }>;
  mechanics: Project["mechanics"];
}

function stableIfid(seed: string): string {
  const hex = createHash("sha256").update(`story-to-cyoa:${seed}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("").toUpperCase();
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function js(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function renderChoice(choice: Project["passages"][number]["choices"][number], destination: string): string {
  const condition = `setup.storyToCyoA.conditions($storyState, ${js(choice.conditions)})`;
  const link = `<<link ${js(choice.label)} ${js(destination)}>><<run setup.storyToCyoA.applyEffects($storyState, ${js(choice.effects)})>><</link>>`;
  return choice.conditions.length ? `<<if ${condition}>>${link}<</if>>` : link;
}

export function playableStoryData(project: Project): PlayableStoryData {
  return {
    title: project.name,
    startPassageId: project.startPassageId,
    passages: project.passages.map((passage) => ({
      id: passage.id,
      title: passage.title,
      prose: passage.prose,
      ending: passage.ending ?? passage.endingClassification ?? null,
      choices: passage.choices,
    })),
    mechanics: project.mechanics,
  };
}

export function renderTwee(input: Project): string {
  const project = ProjectSchema.parse(input);
  const names = passageNameMap(project);
  const startName = names.get(project.startPassageId);
  if (!startName) throw new Error("Start passage is missing");
  const initialState = {
    stats: Object.fromEntries(Object.entries(project.mechanics.visibleStats).map(([key, value]) => [key, value.initial])),
    relationships: Object.fromEntries(Object.entries(project.mechanics.relationships).map(([key, value]) => [key, value.initial])),
    flags: project.mechanics.hiddenFlags,
    inventory: [] as string[],
    pendingEffects: [] as unknown[],
  };
  const data = playableStoryData(project);
  const encodedData = Buffer.from(JSON.stringify(data), "utf8").toString("base64");
  const passages = project.passages.map((passage) => {
    const name = names.get(passage.id)!;
    const tags = passage.ending || passage.endingClassification ? "passage ending" : "passage";
    const prose = passage.prose.split(/\n\s*\n/).map((paragraph) => escapeTweeText(paragraph)).join("\n\n");
    const choices = passage.choices.map((choice) => renderChoice(choice, names.get(choice.destinationId) ?? choice.destinationId)).join("\n");
    return `:: ${name} [${tags}]\n${prose}${choices ? `\n\n${choices}` : ""}`;
  }).join("\n\n");

  return [
    `:: StoryTitle\n${escapeTweeText(project.name)}`,
    `:: StoryData\n${js({ ifid: stableIfid(project.id), format: "SugarCube", "format-version": "2.37.3", start: startName })}`,
    `:: StoryInit\n<<set $storyState = ${js(initialState)}>><<set $stats = $storyState.stats>><<set $relationships = $storyState.relationships>><<set $inventory = $storyState.inventory>>`,
    `:: StoryCaption [nobr]\n<div class="story-stats"><strong>Stats</strong><<for _key, _definition range ${js(project.mechanics.visibleStats)}>><div><<= _definition.label>>: <<= $stats[_key]>></div><</for>><<for _key, _definition range ${js(project.mechanics.relationships)}>><div><<= _definition.label>>: <<= setup.storyToCyoA.relationshipLabel(_definition, $relationships[_key])>></div><</for>><<if $inventory.length>><div><strong>Inventory</strong>: <<= $inventory.join(", ")>></div><</if>></div>`,
    `:: StoryToCyoASetup [script]\n${storyScript.trim()}\n/*STORY_TO_CYOA_DATA:${encodedData}*/`,
    passages,
  ].join("\n\n");
}
