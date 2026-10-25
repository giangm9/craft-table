// Claude in the studio: each time a person sends a message, the server runs Claude (Claude Agent SDK) in a SANDBOX:
//   • NO built-in tools (tools: []), none of the machine's settings/skills/hooks (settingSources: [], skills: []),
//     no other MCP server (strictMcpConfig) — only the studio's tool set (agent-tools.mjs), running in-process, each
//     tool locked to the version + thread. No Bash. Two "run code indirectly" paths are blocked too: CSS with
//     @plugin/@config (Tailwind runs a JS/TS file inside the server — css-guard in the tools + the Vite plugin) and a
//     board calling local APIs through the screenshot browser (shots only GETs the files of the right version).
//     init reports an unknown tool → the turn is cancelled.
//   • Its own short system prompt (replacing Claude Code's ~30k-token default); detailed rules are read per topic
//     with the `rules` tool. The per-turn prompt carries only the NEW messages + ids (marks, images) — Claude opens
//     older messages, files and frame images itself with the tools, looping over many steps to the final answer.
//   • A clean environment (drops the CLAUDE* variables inherited from the session that started the studio), its own
//     working folder ~/.design-agent.
//   • Everything Claude reads follows the PROJECT language (craft-table.json "language"; lib/i18n/agent.mjs); Claude
//     replies in the language the person wrote in.
// Measured: the first call is ~4.8k tokens.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { allRefs, refChangesSince, textWithThreadMarks } from "./thread-core.mjs";
import { createAgentTools, defaultRules, ruleTopics } from "./agent-tools.mjs";
import { createDesignTools, DESIGN_TOOL_NAMES } from "./agent-tools-design.mjs";
import { isDesignThread, mentionsOf } from "./thread-core.mjs";
import { lint, typecheck } from "./checks.mjs";
import { createVerifyGuard } from "./verify-guard.mjs";
import { normalizeLang, translate } from "./i18n.mjs";
import AGENT from "./i18n/agent.mjs";

/** Text of `key` in the project's language `lang` (unknown → English). */
const say = (lang, key, params) => translate(AGENT, lang, key, params);

const MAX_STOP_BLOCKS = 2;
/**
 * Stop hook: a self-check step still missing (the guard) → block the end of the turn, saying what is missing. Blocks
 * at most 2 times per turn (no endless loop when Claude cannot check, e.g. the screenshot browser is broken).
 * lang: the project's language.
 */
export function makeStopHook(guard, { lang = "en" } = {}) {
  let blocks = 0;
  return async () => {
    const miss = guard.missing();
    if (!miss.length || blocks >= MAX_STOP_BLOCKS) return {};
    blocks++;
    return { decision: "block", reason: say(lang, "stopUnchecked", { steps: miss.join(", ") }) };
  };
}

export const agentCwd = () => path.join(os.homedir(), ".design-agent");
export { DESIGN_TOOL_NAMES };
/** A whole-design turn: many more steps and a long time — one change can reach every screen. */
export const DESIGN_MAX_TURNS = 300;
export const DESIGN_TIMEOUT_MS = 60 * 60_000;
export const TOOL_NAMES = ["list", "read", "search", "read_thread", "view_frame", "view_region", "view_image", "locate", "edit", "write", "check", "rules"];

/**
 * The system prompt for Claude in the studio of ONE project, in the project's language. project = the loaded
 * craft-table.json (lib/project.mjs); topics = the rule topics that really exist (craft-table's own + the project's).
 */
export function systemPrompt({ project, topics }) {
  return say(project.language, "systemPrompt", {
    name: project.name,
    description: project.description || "",
    sourceRoots: project.source ? project.source.roots.map((r) => `src:${r}/…`).join(", ") : null,
    sourceLabel: project.source?.label ?? null,
    topics: topics.join(", "),
  });
}

/**
 * Environment of the Claude process: drops CLAUDE* (from the session that started the studio), keeps the rest —
 * except CLAUDE_CODE_OAUTH_TOKEN: the studio's own sign-in token (`claude setup-token`) when running in Docker.
 */
export function cleanEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k, v]) => v !== undefined && (k === "CLAUDE_CODE_OAUTH_TOKEN" || !/^CLAUDE/.test(k))));
}

/** Mark of a session created by this sandbox — a thread holding an unmarked session (the old `claude -p` way) does not resume it. */
export const SESSION_KIND = "sandbox";

// Texts the studio itself stores in a thread (agent.progress, agent.error) are { key, params? }: words in no
// language, rendered in the viewer's language by the UI (studio/src/i18n/agent-status.ts, keys listed there).
// Free text from the SDK or from Claude stays a plain string.
const stored = (key, params) => (params ? { key, params } : { key });
// Why a turn was cut short → the error stored when the cut ends the SDK run with an exception ("stopped (…)").
const STOPPED = { userStopped: "stoppedByUser", timedOut: "stoppedTimedOut", sandboxLeak: "stoppedSandboxLeak" };
const stoppedError = (why) => (why ? { ...why, key: STOPPED[why.key] ?? why.key } : stored("stoppedByUser"));

/**
 * Error shown when Claude in the studio is signed out (no token, expired, revoked), with the command that signs it in
 * again: craft-table's own by default; a project run another way (e.g. in Docker) sets CRAFT_LOGIN_HINT.
 */
export const loginLostError = (env = process.env) => stored("loginLost", { command: env.CRAFT_LOGIN_HINT || "npx craft-table login" });

/** The system prompt of a WHOLE-DESIGN thread; `sandbox`: scripts (the run tool) are available. */
export function designSystemPrompt({ project, topics, sandbox }) {
  return say(project.language, "designSystemPrompt", {
    name: project.name,
    description: project.description || "",
    sourceRoots: project.source ? project.source.roots.map((r) => `src:${r}/…`).join(", ") : null,
    sourceLabel: project.source?.label ?? null,
    topics: topics.join(", "),
    sandbox: !!sandbox,
  });
}

/** SDK options of the sandbox (pure — for tests). design: a whole-design turn (more steps, the design tools; `run` only when run !== false). */
export function sdkOptions({ model, effort, sessionId, mcpServer, systemPrompt: prompt, design = false, run = true }) {
  const names = design ? [...TOOL_NAMES, ...DESIGN_TOOL_NAMES.filter((n) => n !== "run" || run)] : TOOL_NAMES;
  return {
    model,
    ...(effort ? { effort } : {}),
    systemPrompt: prompt,
    tools: [],
    settingSources: [],
    skills: [],
    strictMcpConfig: true,
    mcpServers: { studio: mcpServer },
    allowedTools: names.map((n) => `mcp__studio__${n}`),
    permissionMode: "dontAsk",
    maxTurns: design ? DESIGN_MAX_TURNS : 80,
    ...(sessionId ? { resume: sessionId } : {}),
  };
}

/** Own working folder outside the project (does not inherit the .claude/ of the folder the studio runs in). */
export function ensureAgentHome() {
  const dir = agentCwd();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The per-turn prompt for Claude: ONLY the new messages + ids. A new session also gets one line of thread context.
 * [#k] in a message's text (that message's k-th mark) becomes the thread-wide number, to match view_region(n).
 * lang: the project's language (unknown → English).
 */
export function buildPrompt({ thread, meta, pending, resume, viewing = thread.entry, lang = "en" }) {
  const design = isDesignThread(thread);
  if (design && viewing === thread.entry) viewing = null; // "*" is no screen
  const refs = allRefs(thread);
  const before = thread.messages.findIndex((m) => m.id === pending[0]?.id);
  const body = pending.map((m) => {
    const mine = refs.filter((r) => r.messageId === m.id);
    const lines = [say(lang, "promptMessage", { author: m.author, text: textWithThreadMarks(thread, m, refs) })];
    for (const r of mine) lines.push(say(lang, "promptMark", { n: r.n, scenario: r.scenario, viewport: r.viewport, removed: !!r.removed }));
    (m.images ?? []).forEach((id, i) => lines.push(say(lang, "promptImage", { n: i + 1, id })));
    return lines.join("\n");
  }).join("\n\n");
  // The person removed / redrew an EARLIER mark after Claude's last turn → say so, so Claude does not follow the old area.
  const lastClaude = thread.messages.slice(0, Math.max(before, 0)).findLast((m) => m.role === "claude");
  const pendingIds = new Set(pending.map((m) => m.id));
  const changed = lastClaude?.at ? refChangesSince(thread, lastClaude.at, { lang }).filter((c) => !pendingIds.has(refs[c.n - 1].messageId)) : [];
  const changes = changed.length ? `${say(lang, "promptMarkChanges", { changes: changed })}\n` : "";
  // A thread is shared by the main screen + its options: once an option was viewed, say which screen this turn is on.
  const mixed = viewing !== thread.entry || thread.messages.some((m) => m.viewing && m.viewing !== thread.entry);
  const where = design ? (viewing ? `${say(lang, "promptViewingDesign", { entry: viewing })}\n` : "") : mixed ? `${say(lang, "promptViewing", { main: viewing === thread.entry, entry: viewing })}\n` : "";
  // The screens the person named with @[screen-id] in the new messages.
  const ids = mentionsOf(pending.map((m) => m.text).join("\n"));
  const ment = ids.length ? `${say(lang, "promptMentions", { ids })}\n` : "";
  if (resume) return `${where}${ment}${changes}${body}`;
  if (design) return `${say(lang, "promptHeadDesign", { thread: thread.id, version: thread.version, before: Math.max(before, 0) })}\n${where}${ment}${changes}${body}`;
  const head = say(lang, "promptHead", { thread: thread.id, version: thread.version, entry: thread.entry, title: meta?.title ?? thread.entry, before: Math.max(before, 0) });
  return `${head}\n${where}${ment}${changes}${body}`;
}

/** SDK event → what Claude is doing now, for the UI ({ key, params }); null when not worth showing. */
export function progressOf(ev) {
  if (ev?.type !== "assistant") return null;
  const t = ev.message?.content?.find((c) => c.type === "tool_use");
  if (!t) return null;
  const i = t.input ?? {};
  const s = (v) => String(v ?? "");
  switch (String(t.name).replace(/^mcp__studio__/, "")) {
    case "list": return stored("listing", { what: s(i.what) });
    case "read": return stored("reading", { path: s(i.path) });
    case "search": return stored("searching", { pattern: s(i.pattern) });
    case "read_thread": return stored("readingThread");
    case "view_frame": return stored("viewingFrame", { entry: s(i.entry), scenario: s(i.scenario), viewport: s(i.viewport) });
    case "view_region": return stored("viewingMark", { n: i.n });
    case "view_image": return stored("viewingImage");
    case "locate": return stored("locating", { text: s(i.text) });
    case "edit": case "write": return stored("editing", { path: s(i.path) });
    case "check": return stored("checking", { what: s(i.what) });
    case "rules": return stored("readingRules", { topic: s(i.topic) });
    case "replace": return stored("replacing", { pattern: s(i.pattern) });
    case "browse": return stored("browsing", { what: i.all ? "all" : String(Array.isArray(i.frames) ? i.frames.length : 0) });
    case "run": return stored("running", { command: s(i.command).slice(0, 80) });
    default: return stored("usingTool", { name: s(t.name) });
  }
}

/**
 * Runs one Claude turn for a thread. ctx = { version, threadId, entry } locks the tool set.
 * Returns Promise<{ ok, text, sessionId, costUsd, error? }> with .stop() (cancel midway).
 */
/** Rules: craft-table's own in the project's language, then the project's rules/ (same name → the project's wins). */
export const rulesDirsFor = (root, lang) => [defaultRules(lang), path.join(root, "rules")];

export function runAgent({ root, project = { name: path.basename(root), description: "", language: "en", source: null }, model, effort, sessionId, prompt, ctx, shots, onProgress, onSession, design = false, sandbox = null, timeoutMs = design ? DESIGN_TIMEOUT_MS : 15 * 60_000, queryImpl = query }) {
  const lang = normalizeLang(project.language) ?? "en";
  const abortController = new AbortController();
  let why = null; // { key, params? } of why the turn was cut short (see STOPPED)
  const timer = setTimeout(() => { why = stored("timedOut", { minutes: Math.round(timeoutMs / 60_000) }); abortController.abort(); }, timeoutMs);
  const rulesDirs = rulesDirsFor(root, lang);
  const plainLanguage = project.lint?.plainLanguage ?? false;
  const baseTools = createAgentTools({
    root, source: project.source, ctx, shots, rulesDirs, lang, design,
    checks: { typecheck, lint: (r, v, e) => lint(r, v, e, { plainLanguage, lang }) },
    threadsDir: path.join(root, "threads"), uploadsDir: path.join(root, "data", "uploads"),
  });
  // A whole-design turn also gets the bulk / browser / script tools; `run` only when the machine has a sandbox.
  const tools = design ? [...baseTools, ...createDesignTools({ root, ctx, shots, sandbox, lang })] : baseTools;
  const instructions = (design ? designSystemPrompt : systemPrompt)({ project: { ...project, language: lang }, topics: ruleTopics(rulesDirs), sandbox });
  // The self-check guard: records every tool call of this turn (succeeded or failed).
  const guard = createVerifyGuard({ lang });
  const watched = tools.map((t) => tool(t.name, t.description, t.shape, async (args, extra) => {
    const r = await t.handler(args, extra);
    guard.record(t.name, args, !r.isError, r.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n"));
    return r;
  }));
  const mcpServer = createSdkMcpServer({ name: "studio", alwaysLoad: true, tools: watched });
  let sid = sessionId ?? null;
  let loginLost = false;
  const done = (async () => {
    try {
      let result = null;
      const hooks = { Stop: [{ hooks: [makeStopHook(guard, { lang })] }] };
      const q = queryImpl({ prompt, options: { ...sdkOptions({ model, effort, sessionId, mcpServer, systemPrompt: instructions, design, run: !!sandbox }), hooks, abortController, cwd: ensureAgentHome(), env: cleanEnv(process.env) } });
      for await (const ev of q) {
        // Fail closed: the SDK reports a tool outside the studio's set (e.g. an SDK upgrade changed a default) → cancel the turn now.
        if (ev.type === "system" && ev.subtype === "init") {
          const extra = (ev.tools ?? []).filter((n) => !String(n).startsWith("mcp__studio__"));
          if (extra.length) {
            why = stored("sandboxLeak", { tools: extra.join(", ") });
            abortController.abort();
            return { ok: false, text: "", sessionId: sid, costUsd: null, error: why };
          }
        }
        if (ev.type === "assistant" && ev.error === "authentication_failed") loginLost = true;
        if (ev.session_id && ev.session_id !== sid) { sid = ev.session_id; onSession?.(sid); }
        const p = progressOf(ev);
        if (p) onProgress?.(p);
        if (ev.type === "result") result = ev;
      }
      if (result?.subtype === "success" && !result.is_error) return { ok: true, text: String(result.result ?? ""), sessionId: sid, costUsd: result.total_cost_usd ?? null };
      return { ok: false, text: "", sessionId: sid, costUsd: result?.total_cost_usd ?? null, error: why ?? (loginLost ? loginLostError() : result ? `${result.subtype}${result.result ? `: ${result.result}` : ""}` : stored("noResult")) };
    } catch (e) {
      return { ok: false, text: "", sessionId: sid, costUsd: null, error: abortController.signal.aborted ? stoppedError(why) : loginLost ? loginLostError() : String(e?.message ?? e).slice(0, 400) };
    } finally {
      clearTimeout(timer);
    }
  })();
  done.stop = () => { if (!why) why = stored("userStopped"); abortController.abort(); };
  return done;
}
