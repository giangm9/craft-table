#!/usr/bin/env node
// The studio's command line (run inside the project folder, or set CRAFT_PROJECT): read threads, shoot frames, check.
// Used by people and by Claude Code; its output is English.
//   node studio/chat.mjs list [entry]                          threads (newest first)
//   node studio/chat.mjs show <thread>                         print a conversation
//   node studio/chat.mjs crop <thread> <mark-number> [out.png] exactly a mark's region (red outline + margin)
//   node studio/chat.mjs shot <entry> [scenario|-] [desktop|mobile] [out.png]   a whole frame
//   node studio/chat.mjs locate <entry> <scenario|-> <desktop|mobile> "<text>"  coordinates of the element holding a text
//   node studio/chat.mjs typecheck                             tsc for the design (must be clean)
//   node studio/chat.mjs lint [entry]                          the "descriptions are plain language" rule (meta + Behavior tab)
//   node studio/chat.mjs spec <entry> [behavior|tech]          shoot the spec page + report broken diagrams / embedded code
//   node studio/chat.mjs reply <thread> "text"                 Claude replies by hand (@mark(...) allowed)
// Every command also takes --v=<version> (default: the live version — versions/index.json).
import fs from "node:fs";
import path from "node:path";
import { allRefs, transcript, parseAgentReply, loadThread, listThreads } from "./lib/threads.mjs";
import { readIndex, isValidVersionId } from "./lib/versions.mjs";
import { createShots } from "./lib/shots.mjs";
import { lint, typecheck } from "./lib/checks.mjs";
import { loadProject, toolBase } from "./lib/project.mjs";

const PROJECT = loadProject();
const ROOT = PROJECT.dir;
const BASE = process.env.STUDIO_URL || "http://127.0.0.1:5180";
const THREADS = path.join(ROOT, "threads");
const SHOTS = path.join(ROOT, ".chat-shots");
const WIDTH = { desktop: 1280, mobile: 390 };
const die = (m) => { console.error(m); process.exit(2); };
const argv = process.argv.slice(2);
const vArg = argv.find((a) => a.startsWith("--v="));
const V = vArg ? vArg.slice(4) : readIndex(ROOT).live;
if (!isValidVersionId(V) || !fs.existsSync(path.join(ROOT, "versions", V))) die(`no version "${V}"`);
const [cmd, ...args] = argv.filter((a) => a !== vArg);
const BOARDS = path.join(ROOT, "versions", V, "boards");

const shots = createShots({ base: BASE, tool: toolBase(path.resolve(import.meta.dirname, ".."), ROOT), externalOrigins: PROJECT.config.externalOrigins, desktop: () => PROJECT.config.desktop, idleMs: 60_000 });

switch (cmd) {
  case "list": {
    const ts = await listThreads(THREADS, args[0]);
    console.log(ts.length ? ts.map((t) => `${t.id} [${t.status}${t.agent?.state === "running" ? ", claude is working" : ""}] ${t.entry} · ${t.title} · ${t.messages.length} messages`).join("\n") : "(no threads yet)");
    break;
  }
  case "show": {
    const t = await loadThread(THREADS, args[0] ?? die("missing thread id")) ?? die("no such thread");
    console.log(`Thread "${t.title}" (${t.id}) · ${t.entry}\n\n${transcript(t, t.messages)}`);
    break;
  }
  case "crop": {
    const [id, nS, outArg] = args;
    const t = await loadThread(THREADS, id ?? die("missing thread id")) ?? die("no such thread");
    const ref = allRefs(t).find((r) => r.n === Number(nS)) ?? die(`the thread has no mark #${nS}`);
    fs.mkdirSync(SHOTS, { recursive: true });
    const out = outArg ?? path.join(SHOTS, `${t.id}-${ref.n}.png`);
    const r = await shots.region({ version: V, entry: t.entry, ref });
    fs.writeFileSync(out, r.png);
    console.log(`${out}\n(mark #${ref.n}: scenario ${ref.scenario ?? "-"} · ${ref.viewport} · ${ref.rect.x},${ref.rect.y},${ref.rect.w},${ref.rect.h})`);
    break;
  }
  case "shot": {
    const [entry, scenario = "-", viewport = "desktop", outArg] = args;
    if (!entry) die("missing entry");
    fs.mkdirSync(SHOTS, { recursive: true });
    const out = outArg ?? path.join(SHOTS, `${entry.replaceAll("/", "__")}${scenario !== "-" ? `#${scenario}` : ""}--${viewport}.png`);
    const r = await shots.frame({ version: V, entry, scenario, viewport, part: "full" });
    fs.writeFileSync(out, r.png);
    console.log(out + (r.errors.length ? `\nJS ERRORS: ${r.errors.join(" | ")}` : ""));
    break;
  }
  case "locate": {
    const [entry, scenario, viewport, ...q] = args;
    const text = q.join(" ").trim();
    if (!entry || !scenario || !["desktop", "mobile"].includes(viewport) || !text) die('usage: locate <entry> <scenario|-> <desktop|mobile> "<text>"');
    const hits = await shots.locate({ version: V, entry, scenario, viewport, text });
    if (!hits.length) console.log(`"${text}" not found`);
    for (const h of hits) console.log(`${h.tag} "${h.text}" → @mark(${scenario}, ${viewport}, ${h.x}, ${h.y}, ${h.w}, ${h.h})`);
    break;
  }
  case "typecheck": {
    const r = await typecheck(ROOT, V, { studio: false });
    console.log(r.out);
    process.exitCode = r.ok ? 0 : 1;
    break;
  }
  case "spec": {
    const [entry, kind = "behavior"] = args;
    if (!entry) die("missing entry");
    // No file for this tab yet → say so at once (it used to wait for the 60-second timeout).
    if (!fs.existsSync(path.join(BOARDS, `${entry}.${kind}.md`))) die(`no versions/${V}/boards/${entry}.${kind}.md yet`);
    fs.mkdirSync(SHOTS, { recursive: true });
    const out = path.join(SHOTS, `spec-${entry.replaceAll("/", "__")}-${kind}.png`);
    const { png, report: rep } = await shots.specPage({ version: V, entry, kind });
    fs.writeFileSync(out, png);
    console.log(out);
    console.log(`diagrams: ${rep.diagrams} rendered${rep.badDiagrams.length ? `, ${rep.badDiagrams.length} FAILED: ${rep.badDiagrams.join(" | ")}` : ""} · embedded code: ${rep.embeds}${rep.badEmbeds.length ? `, ${rep.badEmbeds.length} BROKEN: ${rep.badEmbeds.join(" | ")}` : ""} · rules: ${rep.rules}${rep.errs.length ? ` · JS ERRORS: ${rep.errs.join(" | ")}` : ""}`);
    process.exitCode = rep.badDiagrams.length || rep.badEmbeds.length || rep.errs.length ? 1 : 0;
    break;
  }
  case "lint": {
    // Board descriptions, scenario descriptions and the Behavior tab must be plain language (technical → the Technical tab).
    const entries = args[0] ? [args[0]] : (await (await fetch(`${BASE}/__api/entries?v=${V}`)).json()).entries.map((e) => e.id).filter((id) => id.startsWith("screens/"));
    const r = lint(ROOT, V, entries, { plainLanguage: PROJECT.config.lint.plainLanguage, lang: PROJECT.config.language, uiLang: "en" });
    for (const i of r.issues) console.log(`✗ ${i}`);
    console.log(r.ok ? "✓ descriptions and the Behavior tab are plain language" : `✗ ${r.issues.length} place(s) not in plain language — move the technical parts to the Technical tab (.tech.md)`);
    process.exitCode = r.ok ? 0 : 1;
    break;
  }
  case "reply": {
    const [id, ...t] = args;
    const th = await loadThread(THREADS, id ?? die("missing thread id")) ?? die("no such thread");
    const { text, refs } = parseAgentReply(t.join(" "));
    const res = await fetch(`${BASE}/__api/threads/${th.id}/claude`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, refs }) });
    // Through the API (not a direct file write), so the server writes in order and tells the UI.
    console.log(res.ok ? "✓ replied" : `✗ ${res.status} ${await res.text()}`);
    break;
  }
  default:
    die("commands: list | show | crop | shot | locate | typecheck | lint | spec | reply  (see the top of studio/chat.mjs)");
}

await shots.close();
