import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { escapeHtml } from "./escape.js";
import type { PlayableStoryData } from "./render-twee.js";

export interface CompileOptions {
  tweegoPath?: string;
  allowFallback?: boolean;
}

export interface ExportResult {
  outputPath: string;
  compiler: "tweego" | "fallback";
  bytes: number;
}

function extractPlayableData(twee: string): PlayableStoryData {
  const encoded = twee.match(/\/\*STORY_TO_CYOA_DATA:([A-Za-z0-9+/=]+)\*\//)?.[1];
  if (!encoded) throw new Error("Twee does not contain standalone playable data");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as PlayableStoryData;
}

function standaloneHtml(data: PlayableStoryData): string {
  const encoded = Buffer.from(JSON.stringify(data), "utf8").toString("base64");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(data.title)}</title>
<style>body{margin:0;background:#171b24;color:#f4efe5;font:18px/1.6 system-ui,sans-serif}.shell{display:grid;grid-template-columns:minmax(0,48rem) 16rem;gap:2rem;max-width:70rem;margin:auto;padding:3rem 1.5rem}main{background:#222938;padding:2rem;border-radius:1rem}aside{font-size:.9rem}button{display:block;width:100%;margin:.7rem 0;padding:.8rem 1rem;text-align:left;border:1px solid #ba9567;border-radius:.5rem;background:#30291f;color:#fff;cursor:pointer}button:hover{background:#483a2a}.ending{color:#e6bd7b}@media(max-width:750px){.shell{grid-template-columns:1fr;padding:1rem}aside{order:-1}}</style>
</head><body><div class="shell"><main><h1 id="title"></h1><div id="prose"></div><div id="choices"></div></main><aside><h2>Story state</h2><div id="stats"></div><div id="relationships"></div><div id="inventory"></div><button id="restart">Restart</button></aside></div>
<script>
const decodeUtf8Base64=value=>new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(atob(value),character=>character.charCodeAt(0)));
const story=JSON.parse(decodeUtf8Base64("${encoded}")), passages=new Map(story.passages.map(p=>[p.id,p]));
const initial=()=>({stats:Object.fromEntries(Object.entries(story.mechanics.visibleStats).map(([k,v])=>[k,v.initial])),relationships:Object.fromEntries(Object.entries(story.mechanics.relationships).map(([k,v])=>[k,v.initial])),flags:{...story.mechanics.hiddenFlags},inventory:[],pendingEffects:[]});
let state=initial();
const met=c=>c.kind==="statAtLeast"?(state.stats[c.key]||0)>=c.value:c.kind==="flagEquals"?state.flags[c.key]===c.value:c.kind==="hasItem"?state.inventory.includes(c.itemId):c.kind==="relationshipAtLeast"?(state.relationships[c.key]||0)>=c.value:false;
const immediate=e=>{if(e.op==="addStat")state.stats[e.key]=(state.stats[e.key]||0)+e.value;if(e.op==="setFlag")state.flags[e.key]=e.value;if(e.op==="addRelationship")state.relationships[e.key]=(state.relationships[e.key]||0)+e.value;if(e.op==="addItem"&&!state.inventory.includes(e.itemId))state.inventory.push(e.itemId);if(e.op==="removeItem")state.inventory=state.inventory.filter(id=>id!==e.itemId)};
const apply=effects=>{const due=[];state.pendingEffects=state.pendingEffects.filter(p=>{p.remaining--;if(p.remaining<=0)due.push(p.effect);return p.remaining>0});due.forEach(immediate);effects.forEach(e=>e.delay?state.pendingEffects.push({remaining:e.delay==="nextPassage"?1:e.delay,effect:{...e,delay:undefined}}):immediate(e))};
const band=(d,v)=>[...d.bands].sort((a,b)=>b.min-a.min).find(b=>v>=b.min)?.label||d.label;
function sidebar(){const s=document.querySelector("#stats");s.replaceChildren();for(const[k,d]of Object.entries(story.mechanics.visibleStats)){const x=document.createElement("div");x.textContent=d.label+": "+state.stats[k];s.append(x)}const r=document.querySelector("#relationships");r.replaceChildren();for(const[k,d]of Object.entries(story.mechanics.relationships)){const x=document.createElement("div");x.textContent=d.label+": "+band(d,state.relationships[k]);r.append(x)}document.querySelector("#inventory").textContent=state.inventory.length?"Inventory: "+state.inventory.join(", "):""}
function show(id){const p=passages.get(id);if(!p)return;document.querySelector("#title").textContent=p.title;const prose=document.querySelector("#prose");prose.replaceChildren();p.prose.split(/\\n\\s*\\n/).forEach(text=>{const x=document.createElement("p");x.textContent=text;prose.append(x)});const choices=document.querySelector("#choices");choices.replaceChildren();p.choices.filter(c=>c.conditions.every(met)).forEach(c=>{const b=document.createElement("button");b.textContent=c.label;b.onclick=()=>{apply(c.effects);show(c.destinationId)};choices.append(b)});if(p.ending){const e=document.createElement("p");e.className="ending";e.textContent="Ending: "+p.ending;choices.append(e)}sidebar()}
document.querySelector("#restart").onclick=()=>{state=initial();show(story.startPassageId)};show(story.startPassageId);
</script></body></html>`;
}

function runTweego(executable: string, inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, ["-f", "sugarcube-2", "-o", outputPath, inputPath], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { errorOutput += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`Tweego exited with ${code}: ${errorOutput.trim()}`)));
  });
}

export async function compileSugarCube(
  twee: string,
  outputPath: string,
  options: CompileOptions = {},
): Promise<ExportResult> {
  await mkdir(dirname(outputPath), { recursive: true });
  const token = `${process.pid}-${Date.now()}`;
  const temporaryOutput = `${outputPath}.${token}.tmp`;
  const temporaryTwee = `${outputPath}.${token}.twee`;
  const configuredTweego = options.tweegoPath ?? process.env.TWEEGO_PATH ??
    resolve(process.cwd(), "tools", "tweego", process.platform === "win32" ? "tweego.exe" : "tweego");
  let compiler: ExportResult["compiler"] = "fallback";
  try {
    if (existsSync(configuredTweego)) {
      await writeFile(temporaryTwee, twee, "utf8");
      await runTweego(configuredTweego, temporaryTwee, temporaryOutput);
      compiler = "tweego";
    } else {
      if (options.allowFallback === false) throw new Error("Tweego is not installed");
      await writeFile(temporaryOutput, standaloneHtml(extractPlayableData(twee)), "utf8");
    }
    await rename(temporaryOutput, outputPath);
    const bytes = (await readFile(outputPath)).byteLength;
    return { outputPath, compiler, bytes };
  } finally {
    await unlink(temporaryTwee).catch(() => undefined);
    await unlink(temporaryOutput).catch(() => undefined);
  }
}
