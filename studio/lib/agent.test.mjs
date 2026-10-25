import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { systemPrompt, loginLostError, sdkOptions, cleanEnv, buildPrompt, progressOf, runAgent, rulesDirsFor, TOOL_NAMES, makeStopHook, compactWindow } from "./agent.mjs";
import { RULES_ROOT } from "./agent-tools.mjs";
import { createVerifyGuard } from "./verify-guard.mjs";
import { VIETNAMESE } from "./i18n-gate.mjs";

test("leaky sandbox (the SDK reports a tool outside mcp__studio__*, e.g. after an SDK upgrade) → the turn is cancelled at once, with an error", async () => {
  let aborted = false;
  const leaky = ({ options }) => {
    options.abortController.signal.addEventListener("abort", () => { aborted = true; });
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: "s-9", tools: ["Bash", "mcp__studio__list"], mcp_servers: [{ name: "studio", status: "connected" }] };
      yield { type: "result", subtype: "success", result: "ran Bash", total_cost_usd: 0 };
    })();
  };
  const r = await runAgent({ root: ROOT, model: "sonnet", prompt: "P", ctx: { version: "ban-1", threadId: "t_1", entry: "screens/a" }, shots: {}, queryImpl: leaky });
  assert.equal(r.ok, false);
  // Stored in the thread as { key, params } — words in no language; the UI renders it (src/i18n/agent-status.ts).
  assert.deepEqual(r.error, { key: "sandboxLeak", params: { tools: "Bash" } });
  assert.equal(aborted, true);
});

test("Stop hook: the reminder says only errors in files Claude edited are its job (project language)", async () => {
  const g = createVerifyGuard();
  g.record("edit", { path: "boards/screens/a.tsx" }, true);
  assert.match((await makeStopHook(g, { lang: "vi" })({})).reason, /file bạn đã sửa/);
  const en = (await makeStopHook(g, { lang: "en" })({})).reason;
  assert.match(en, /files you edited/);
  assert.doesNotMatch(en, VIETNAMESE);
  assert.match((await makeStopHook(g)({})).reason, /files you edited/, "no language → English");
});

test("Stop hook: a board edited but not checked → the end is blocked, naming the missing steps; at most 2 times, then it lets go", async () => {
  const g = createVerifyGuard();
  const stop = makeStopHook(g, { lang: "vi" });
  assert.deepEqual(await stop({ hook_event_name: "Stop" }), {});
  g.record("edit", { path: "boards/screens/a.tsx" }, true);
  const r1 = await stop({ hook_event_name: "Stop" });
  assert.equal(r1.decision, "block");
  assert.match(r1.reason, /view_frame/);
  assert.match(r1.reason, /check typecheck/);
  assert.match(r1.reason, /^Chưa tự kiểm sau lần sửa cuối: /);
  assert.equal((await stop({ hook_event_name: "Stop" })).decision, "block");
  assert.deepEqual(await stop({ hook_event_name: "Stop" }), {}); // no endless loop
});

const ROOT = "/srv/project";
const PROJECT = { name: "Acme Shop", description: "online store for handmade goods", language: "vi", source: { label: "shop-web", roots: ["src", "docs"] } };
const EN_PROJECT = { ...PROJECT, language: "en" };
const TOPICS = ["boards", "specs", "marks", "design-system"];
const SYSTEM_PROMPT = systemPrompt({ project: PROJECT, topics: TOPICS });
const EN_SYSTEM_PROMPT = systemPrompt({ project: EN_PROJECT, topics: TOPICS });

test("sdkOptions: a closed sandbox — no built-in tools, no user settings/skills, only the studio's tools, its own system prompt", () => {
  const o = sdkOptions({ model: "sonnet", mcpServer: { fake: 1 }, systemPrompt: SYSTEM_PROMPT });
  assert.deepEqual(o.tools, []);
  assert.deepEqual(o.settingSources, []);
  assert.deepEqual(o.skills, []);
  assert.equal(o.strictMcpConfig, true);
  assert.equal(o.permissionMode, "dontAsk");
  assert.equal(o.systemPrompt, SYSTEM_PROMPT);
  assert.equal(o.maxTurns, 80);
  assert.equal(o.model, "sonnet");
  assert.deepEqual(o.mcpServers, { studio: { fake: 1 } });
  assert.equal(o.allowedTools.length, 12);
  assert.ok(o.allowedTools.every((t) => t.startsWith("mcp__studio__")), o.allowedTools.join());
  assert.deepEqual(TOOL_NAMES.map((n) => `mcp__studio__${n}`), o.allowedTools);
  assert.equal(o.resume, undefined);
  assert.equal(sdkOptions({ model: "sonnet", mcpServer: {}, sessionId: "abc" }).resume, "abc");
});

test("system prompt is short (≲ 600 tokens ~ 2,400 chars) in both languages, says explore with the tools + check yourself", () => {
  assert.ok(SYSTEM_PROMPT.length < 2600, `vi: ${SYSTEM_PROMPT.length} chars`);
  assert.ok(EN_SYSTEM_PROMPT.length < 2600, `en: ${EN_SYSTEM_PROMPT.length} chars`);
  for (const k of ["list", "read_thread", "rules", "view_frame", "check", "@khoanh("]) assert.ok(SYSTEM_PROMPT.includes(k), k);
  for (const k of ["list", "read_thread", "rules", "view_frame", "check", "@mark("]) assert.ok(EN_SYSTEM_PROMPT.includes(k), k);
});

test("system prompt follows the project language: Vietnamese project → Vietnamese with @khoanh; English project → English with @mark", () => {
  assert.match(SYSTEM_PROMPT, /^Bạn là Claude, trợ lý thiết kế trong xưởng thiết kế craft-table của dự án Acme Shop/);
  assert.doesNotMatch(SYSTEM_PROMPT, /@mark\(/);
  assert.match(EN_SYSTEM_PROMPT, /^You are Claude, the design assistant in the craft-table design studio of the project Acme Shop/);
  assert.doesNotMatch(EN_SYSTEM_PROMPT, VIETNAMESE);
  assert.doesNotMatch(EN_SYSTEM_PROMPT, /@khoanh/);
  assert.match(EN_SYSTEM_PROMPT, /Behavior, Technical/);
});

test("system prompt: reply in the language the person wrote in (the project's language when unclear)", () => {
  assert.match(SYSTEM_PROMPT, /Trả lời bằng đúng ngôn ngữ người dùng đã viết \(không rõ thì dùng tiếng Việt\)/);
  assert.doesNotMatch(SYSTEM_PROMPT, /Trả lời tiếng Việt bằng/);
  assert.match(EN_SYSTEM_PROMPT, /Reply in the language the person wrote in \(English when unclear\)/);
});

test("system prompt: edit in place, an option only on request; two readings → name each way (Way A — …)", () => {
  assert.match(SYSTEM_PROMPT, /Hướng A — /);
  assert.match(EN_SYSTEM_PROMPT, /Way A — /);
  assert.match(EN_SYSTEM_PROMPT, /edit it in place, whatever its status/);
  assert.match(EN_SYSTEM_PROMPT, /Make an option .* only when the person asks for one — what they call a new version, another version, a variant or an alternative is an option/);
  assert.match(EN_SYSTEM_PROMPT, /Never make or propose a new version of the whole design/);
  assert.match(SYSTEM_PROMPT, /Không bao giờ tạo hay đề xuất phiên bản mới/);
  assert.doesNotMatch(EN_SYSTEM_PROMPT, /Option A — /);
});

test("systemPrompt: names the project + its description, the rule topics it really has, and its source repo (if any)", () => {
  for (const p of [SYSTEM_PROMPT, EN_SYSTEM_PROMPT]) {
    assert.match(p, /Acme Shop/);
    assert.match(p, /online store for handmade goods/);
    assert.match(p, /boards, specs, marks, design-system/);
    assert.match(p, /src:src\/…, src:docs\/…/);
    assert.match(p, /shop-web/);
  }
  for (const language of ["vi", "en"]) {
    const bare = systemPrompt({ project: { name: "X", description: "", language, source: null }, topics: ["marks"] });
    assert.doesNotMatch(bare, /src:|shop-web/);
    assert.doesNotMatch(bare, / — \s*—/);
    assert.doesNotMatch(bare, /cửa hàng đồ thủ công|handmade goods/, "no domain of another project");
  }
});

test("loginLostError: a { key, params } text with how to sign Claude in again (project may override the command)", () => {
  assert.deepEqual(loginLostError({}), { key: "loginLost", params: { command: "npx craft-table login" } });
  assert.deepEqual(loginLostError({ CRAFT_LOGIN_HINT: "make studio-login" }), { key: "loginLost", params: { command: "make studio-login" } });
});

test("cleanEnv: drops every CLAUDE* variable (the session of whoever runs the studio), keeps HOME/PATH", () => {
  const e = cleanEnv({ HOME: "/root", PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "x", CLAUDE_AGENT_SDK_VERSION: "y", ANTHROPIC_X: "keep" });
  assert.deepEqual(e, { HOME: "/root", PATH: "/bin", ANTHROPIC_X: "keep" });
});

test("cleanEnv: KEEPS the studio's own sign-in token (CLAUDE_CODE_OAUTH_TOKEN, running in Docker)", () => {
  const e = cleanEnv({ HOME: "/h", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x", CLAUDE_CODE_SESSION_ID: "x" });
  assert.deepEqual(e, { HOME: "/h", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x" });
});

test("signed out (no token / expired token) → a plain message with how to sign in again, not the raw API error", async () => {
  // The exact event sequence the SDK yields with a broken token (measured): assistant error=authentication_failed → result is_error → throws.
  const noAuth = () => (async function* () {
    yield { type: "system", subtype: "init", session_id: "s-1", tools: ["mcp__studio__list"] };
    yield { type: "assistant", error: "authentication_failed", message: { content: [{ type: "text", text: "Failed to authenticate. API Error: 401 OAuth access token is invalid." }] } };
    yield { type: "result", subtype: "success", is_error: true, result: "Failed to authenticate. API Error: 401 OAuth access token is invalid." };
    throw new Error("Claude Code returned an error result: Failed to authenticate.");
  })();
  const r = await runAgent({ root: ROOT, model: "sonnet", prompt: "P", ctx: { version: "ban-1", threadId: "t_1", entry: "screens/a" }, shots: {}, queryImpl: noAuth });
  assert.equal(r.ok, false);
  assert.equal(r.error.key, "loginLost");
  assert.match(r.error.params.command, /craft-table login/);
  assert.doesNotMatch(JSON.stringify(r.error), /API Error|401/);
});

const ref = (scenario, viewport) => ({ scenario, viewport, rect: { x: 1, y: 2, w: 3, h: 4 }, texts: ["chữ dài không được nhồi"] });
const thread = {
  id: "t_1", entry: "screens/orders/list", version: "ban-2", title: "Vòng chọn",
  messages: [
    { id: "m1", role: "user", author: "u@x", text: "Tin CŨ không được chép", refs: [ref("it-don", "mobile")], images: [] },
    { id: "m2", role: "claude", author: "claude", text: "Trả lời cũ", refs: [], images: [] },
    { id: "m3", role: "user", author: "ana", text: "Đổi thành 3 nút [#1] như ảnh", refs: [ref("nhieu-don", "desktop")], images: ["0123456789abcdef.png"] },
  ],
  agent: { state: "idle" },
};
const meta = { title: "Đơn hàng · hiện tại", scenarios: [{ id: "it-don", title: "Ít đơn" }] };

test("buildPrompt, new session: only the new messages + ids; no copy of the old conversation, no rules", () => {
  const p = buildPrompt({ thread, meta, pending: [thread.messages[2]], resume: false, lang: "vi" });
  assert.match(p, /Luồng t_1 · phiên bản ban-2 · màn screens\/orders\/list \("Đơn hàng · hiện tại"\) · 2 tin trước \(read_thread để xem\)/);
  // [#k] in a message = that MESSAGE's k-th mark; the prompt uses the thread-wide number (#2) to match view_region(2).
  assert.match(p, /Tin mới — ana:\nĐổi thành 3 nút \[#2\] như ảnh/);
  assert.match(p, /Vùng khoanh #2: kịch bản nhieu-don · desktop → view_region\(2\)/);
  assert.match(p, /Ảnh 1 → view_image\("0123456789abcdef\.png"\)/);
  for (const bad of ["Tin CŨ", "Trả lời cũ", "chữ dài không được nhồi", "Ít đơn", "design system"]) assert.ok(!p.includes(bad), bad);
  assert.ok(p.length < 600, `${p.length} chars`);
});

test("buildPrompt: a thread that has visited an option → says which screen the person is viewing (also when resuming, also back on the main screen)", () => {
  const OPT = "screens/orders/list~ba-nut";
  const base = { ...thread, messages: [{ id: "m1", role: "user", author: "ana", text: "sửa nút", refs: [], images: [], viewing: OPT }] };
  const p1 = buildPrompt({ thread: base, meta, pending: base.messages, resume: false, viewing: OPT, lang: "vi" });
  assert.match(p1, /Người dùng đang xem phương án screens\/orders\/list~ba-nut — mặc định làm trên màn này\./);
  const back = { ...base, messages: [...base.messages, { id: "m2", role: "claude", author: "claude", text: "ok", refs: [], images: [] }, { id: "m3", role: "user", author: "ana", text: "giờ màn chính", refs: [], images: [] }] };
  const p2 = buildPrompt({ thread: back, meta, pending: [back.messages[2]], resume: true, viewing: back.entry, lang: "vi" });
  assert.match(p2, /Người dùng đang xem màn chính screens\/orders\/list/);
  // A thread that never touched an option → the prompt as before (no extra line).
  assert.doesNotMatch(buildPrompt({ thread, meta, pending: [thread.messages[2]], resume: true, viewing: thread.entry, lang: "vi" }), /đang xem/);
});

test("buildPrompt, resumed session: only the new messages", () => {
  const p = buildPrompt({ thread, meta, pending: [thread.messages[2]], resume: true, lang: "vi" });
  assert.match(p, /^Tin mới — ana:/);
  assert.doesNotMatch(p, /Luồng t_1 ·/);
  assert.match(p, /view_region\(2\)/);
});

test("buildPrompt follows the project language: English project → English prompt (no language → English)", () => {
  const en = {
    ...thread,
    messages: [
      { ...thread.messages[0], text: "old message" },
      { ...thread.messages[1], text: "old reply" },
      { ...thread.messages[2], text: "Make it 3 buttons [#1] like the image", refs: [ref("nhieu-don", "desktop"), { ...ref(null, "mobile"), removed: { by: "ana", at: "x" } }] },
    ],
  };
  const p = buildPrompt({ thread: en, meta: { title: "Orders" }, pending: [en.messages[2]], resume: false, lang: "en" });
  assert.equal(p, [
    'Thread t_1 · version ban-2 · screen screens/orders/list ("Orders") · 2 earlier messages (read_thread to see them).',
    "New message — ana:",
    "Make it 3 buttons [#2] like the image",
    "Mark #2: scenario nhieu-don · desktop → view_region(2)",
    "Mark #3: removed",
    'Image 1 → view_image("0123456789abcdef.png")',
  ].join("\n"));
  assert.equal(buildPrompt({ thread: en, meta: { title: "Orders" }, pending: [en.messages[2]], resume: false }), p);
  const one = { ...en, messages: [en.messages[1], { ...en.messages[2], text: "", refs: [ref(null, "mobile")], images: [] }] };
  assert.equal(buildPrompt({ thread: one, meta: null, pending: [one.messages[1]], resume: false, lang: "en" }), [
    "Thread t_1 · version ban-2 · screen screens/orders/list (\"screens/orders/list\") · 1 earlier message (read_thread to see them).",
    "New message — ana:",
    "(no text)",
    "Mark #1: no scenario · mobile → view_region(1)",
  ].join("\n"));
  const OPT = "screens/orders/list~ba-nut";
  const viewing = { ...en, messages: [{ id: "m1", role: "user", author: "ana", text: "fix it", refs: [], images: [], viewing: OPT }] };
  assert.match(buildPrompt({ thread: viewing, meta, pending: viewing.messages, resume: true, viewing: OPT, lang: "en" }), /^The person is viewing the option screens\/orders\/list~ba-nut — work on this screen by default\.\n/);
  assert.match(buildPrompt({ thread: viewing, meta, pending: viewing.messages, resume: true, viewing: thread.entry, lang: "en" }), /^The person is viewing the main screen screens\/orders\/list/);
});

test("progressOf: one { key, params } per studio tool (words in no language — the UI renders them); not a tool → null", () => {
  const ev = (name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", name: `mcp__studio__${name}`, input }] } });
  assert.deepEqual(progressOf(ev("list", { what: "screens" })), { key: "listing", params: { what: "screens" } });
  assert.deepEqual(progressOf(ev("list", {})), { key: "listing", params: { what: "" } });
  assert.deepEqual(progressOf(ev("read", { path: "src:src/x.ts" })), { key: "reading", params: { path: "src:src/x.ts" } });
  assert.deepEqual(progressOf(ev("search", { pattern: "Save" })), { key: "searching", params: { pattern: "Save" } });
  assert.deepEqual(progressOf(ev("read_thread", {})), { key: "readingThread" });
  assert.deepEqual(progressOf(ev("view_frame", { entry: "screens/orders/today", scenario: "da-giao", viewport: "mobile" })), { key: "viewingFrame", params: { entry: "screens/orders/today", scenario: "da-giao", viewport: "mobile" } });
  assert.deepEqual(progressOf(ev("view_frame", {})), { key: "viewingFrame", params: { entry: "", scenario: "", viewport: "" } });
  assert.deepEqual(progressOf(ev("view_region", { n: 2 })), { key: "viewingMark", params: { n: 2 } });
  assert.deepEqual(progressOf(ev("view_image", { id: "x.png" })), { key: "viewingImage" });
  assert.deepEqual(progressOf(ev("locate", { text: "Save" })), { key: "locating", params: { text: "Save" } });
  assert.deepEqual(progressOf(ev("edit", { path: "boards/screens/a.tsx" })), { key: "editing", params: { path: "boards/screens/a.tsx" } });
  assert.deepEqual(progressOf(ev("write", { path: "boards/screens/b.tsx" })), { key: "editing", params: { path: "boards/screens/b.tsx" } });
  assert.deepEqual(progressOf(ev("check", { what: "typecheck" })), { key: "checking", params: { what: "typecheck" } });
  assert.deepEqual(progressOf(ev("rules", { topic: "marks" })), { key: "readingRules", params: { topic: "marks" } });
  assert.deepEqual(progressOf({ type: "assistant", message: { content: [{ type: "tool_use", name: "OtherTool", input: {} }] } }), { key: "usingTool", params: { name: "OtherTool" } });
  assert.equal(progressOf({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }), null);
  assert.equal(progressOf({ type: "result" }), null);
});

test("runAgent: a timeout ends the turn with { key: 'stoppedTimedOut', params: { minutes } }", async () => {
  const slow = ({ options }) => (async function* () {
    yield { type: "system", subtype: "init", session_id: "s-3" };
    await new Promise((res, rej) => options.abortController.signal.addEventListener("abort", () => rej(new Error("aborted"))));
  })();
  const r = await runAgent({ root: ROOT, model: "sonnet", prompt: "P", ctx: { version: "ban-1", threadId: "t_1", entry: "screens/a" }, shots: {}, queryImpl: slow, timeoutMs: 30 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.error, { key: "stoppedTimedOut", params: { minutes: 0 } });
});

test("runAgent: an SDK run that ends without a result → { key: 'noResult' }; the SDK's own error text stays a string", async () => {
  const none = () => (async function* () { yield { type: "system", subtype: "init", session_id: "s-4" }; })();
  assert.deepEqual((await runAgent({ root: ROOT, model: "sonnet", prompt: "P", ctx: { version: "ban-1", threadId: "t_1", entry: "screens/a" }, shots: {}, queryImpl: none })).error, { key: "noResult" });
  const failed = () => (async function* () { yield { type: "result", subtype: "error_max_turns", result: "too many turns" }; })();
  assert.equal((await runAgent({ root: ROOT, model: "sonnet", prompt: "P", ctx: { version: "ban-1", threadId: "t_1", entry: "screens/a" }, shots: {}, queryImpl: failed })).error, "error_max_turns: too many turns");
  const thrown = () => (async function* () { throw new Error("socket hang up"); })();
  assert.equal((await runAgent({ root: ROOT, model: "sonnet", prompt: "P", ctx: { version: "ban-1", threadId: "t_1", entry: "screens/a" }, shots: {}, queryImpl: thrown })).error, "socket hang up");
});

test("runAgent: reads the SDK's event stream (session, progress, result); stop() cancels", async () => {
  const seen = { progress: [], session: null, options: null };
  const fakeQuery = ({ prompt, options }) => {
    seen.options = options; seen.prompt = prompt;
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: "s-1" };
      yield { type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__studio__list", input: { what: "screens" } }], usage: {} } };
      yield { type: "result", subtype: "success", result: "Done [#1]", total_cost_usd: 0.01, session_id: "s-1" };
    })();
  };
  const r = await runAgent({ root: ROOT, model: "sonnet", prompt: "P", ctx: { version: "ban-1", threadId: "t_1", entry: "screens/a" }, shots: {}, queryImpl: fakeQuery, onProgress: (p) => seen.progress.push(p), onSession: (s) => { seen.session = s; } });
  assert.deepEqual(r, { ok: true, text: "Done [#1]", sessionId: "s-1", costUsd: 0.01 });
  assert.equal(seen.session, "s-1");
  assert.deepEqual(seen.progress, [{ key: "listing", params: { what: "screens" } }]);
  assert.equal(seen.prompt, "P");
  // Nothing CLAUDE* of the session that started the studio — only the compact window the studio sets itself.
  assert.deepEqual(Object.keys(seen.options.env).filter((k) => k.startsWith("CLAUDE") && k !== "CLAUDE_CODE_OAUTH_TOKEN"), ["CLAUDE_CODE_AUTO_COMPACT_WINDOW"]);
  assert.equal(seen.options.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, String(compactWindow(process.env.STUDIO_AGENT_COMPACT_WINDOW)));
  assert.ok(seen.options.abortController);
  assert.deepEqual(seen.options.tools, []);
  // The Stop hook carries this turn's self-check guard (nothing edited → it lets the turn end).
  assert.deepEqual(await seen.options.hooks.Stop[0].hooks[0]({ hook_event_name: "Stop" }), {});

  const slow = ({ options }) => (async function* () {
    yield { type: "system", subtype: "init", session_id: "s-2" };
    await new Promise((res, rej) => options.abortController.signal.addEventListener("abort", () => rej(new Error("aborted"))));
  })();
  const run = runAgent({ root: ROOT, model: "sonnet", prompt: "P", ctx: { version: "ban-1", threadId: "t_1", entry: "screens/a" }, shots: {}, queryImpl: slow });
  setTimeout(() => run.stop(), 50);
  const r2 = await run;
  assert.equal(r2.ok, false);
  assert.deepEqual(r2.error, { key: "stoppedByUser" });
});

test("rulesDirsFor: craft-table's rules in the project's language, then the project's rules/ (unknown → English)", () => {
  assert.deepEqual(rulesDirsFor("/p", "en"), [path.join(RULES_ROOT, "en"), path.join("/p", "rules")]);
  assert.deepEqual(rulesDirsFor("/p", "vi"), [path.join(RULES_ROOT, "vi"), path.join("/p", "rules")]);
  assert.deepEqual(rulesDirsFor("/p", "fr"), [path.join(RULES_ROOT, "en"), path.join("/p", "rules")]);
});

test("runAgent: the project language picks the system prompt and the built-in rules (no project → English)", async () => {
  const optionsOf = async (project) => {
    let seen = null;
    const q = ({ options }) => { seen = options; return (async function* () { yield { type: "result", subtype: "success", result: "ok" }; })(); };
    await runAgent({ root: ROOT, ...(project ? { project } : {}), model: "sonnet", prompt: "P", ctx: { version: "ban-1", threadId: "t_1", entry: "screens/a" }, shots: {}, queryImpl: q });
    return seen;
  };
  const vi = (await optionsOf(PROJECT)).systemPrompt;
  assert.match(vi, /^Bạn là Claude/);
  assert.match(vi, /đọc rules của chủ đề đó: boards, marks, specs\./);
  const en = (await optionsOf(EN_PROJECT)).systemPrompt;
  assert.match(en, /^You are Claude/);
  assert.match(en, /read the rules for it: boards, marks, specs\./);
  assert.doesNotMatch(en, VIETNAMESE);
  const none = (await optionsOf(null)).systemPrompt;
  assert.match(none, /^You are Claude, the design assistant in the craft-table design studio of the project project/);
});

test("buildPrompt: earlier marks removed / redrawn after Claude's last turn → said first; a removed mark offers no view_region", () => {
  const T = (m) => `2026-10-13T10:0${m}:00.000Z`;
  const base = { ...thread, messages: [
    { ...thread.messages[0], at: T(1), refs: [{ ...ref("it-don", "mobile"), removed: { by: "ana", at: T(3) } }] },
    { ...thread.messages[1], at: T(2), refs: [{ ...ref("it-don", "mobile"), redrawn: { by: "ana", at: T(3) } }] },
    { ...thread.messages[2], at: T(4), refs: [ref("a", "desktop"), { ...ref("b", "desktop"), removed: { by: "ana", at: T(5) } }] },
  ] };
  const p = buildPrompt({ thread: base, meta, pending: [base.messages[2]], resume: true, lang: "vi" });
  assert.match(p, /^Khoanh cũ đã đổi từ lượt trước: #1 đã bỏ \(bỏ qua\), #2 vẽ lại → view_region\(2\)\.\n/);
  assert.match(p, /Vùng khoanh #3: kịch bản a · desktop → view_region\(3\)/);
  assert.match(p, /Vùng khoanh #4: đã bỏ/);
  assert.doesNotMatch(p, /view_region\(4\)/);
  // Nothing changed → no extra line.
  assert.doesNotMatch(buildPrompt({ thread, meta, pending: [thread.messages[2]], resume: true, lang: "vi" }), /Khoanh cũ/);
  const en = buildPrompt({ thread: base, meta, pending: [base.messages[2]], resume: true, lang: "en" });
  assert.match(en, /^Earlier marks changed since the last turn: #1 removed \(ignore it\), #2 redrawn → view_region\(2\)\.\n/);
  assert.match(en, /Mark #4: removed/);
});

// ── whole-design turns ──
import { designSystemPrompt, DESIGN_TOOL_NAMES as DESIGN_NAMES, DESIGN_MAX_TURNS, DESIGN_TIMEOUT_MS } from "./agent.mjs";

test("sdkOptions: a design turn gets many more steps and the design tools, and still nothing built-in", () => {
  const o = sdkOptions({ model: "sonnet", mcpServer: { fake: 1 }, systemPrompt: "P", design: true });
  assert.equal(o.maxTurns, DESIGN_MAX_TURNS);
  assert.ok(DESIGN_MAX_TURNS >= 250);
  assert.deepEqual(o.tools, []);
  for (const n of DESIGN_NAMES) assert.ok(o.allowedTools.includes(`mcp__studio__${n}`), n);
  assert.ok(DESIGN_TIMEOUT_MS >= 30 * 60_000);
  const plain = sdkOptions({ model: "sonnet", mcpServer: { fake: 1 }, systemPrompt: "P" });
  assert.equal(plain.maxTurns, 80);
  assert.ok(!plain.allowedTools.includes("mcp__studio__replace"));
});

test("designSystemPrompt: the whole version is the job; run is mentioned only when there is a sandbox; English and Vietnamese both exist", () => {
  const project = { name: "Acme", description: "tasks app", language: "en", source: null };
  const withBox = designSystemPrompt({ project, topics: ["boards", "specs"], sandbox: true });
  assert.match(withBox, /whole design|all the screens/i);
  assert.match(withBox, /replace/);
  assert.match(withBox, /browse/);
  assert.match(withBox, /\brun\b/);
  const noBox = designSystemPrompt({ project, topics: ["boards"], sandbox: false });
  assert.ok(!/\bthe run tool\b|`run`/.test(noBox));
  assert.match(noBox, /replace/);
  const vi = designSystemPrompt({ project: { ...project, language: "vi" }, topics: ["boards"], sandbox: true });
  assert.match(vi, /toàn bộ thiết kế|mọi màn/);
});

test("buildPrompt: a design thread names the whole design and the screen the person is looking at", () => {
  const thread = { id: "t_9", entry: "*", version: "ban-2", title: "Tighter", messages: [{ id: "m1", role: "user", author: "ana", text: "make it denser", refs: [], images: [] }] };
  const p = buildPrompt({ thread, meta: { title: "Tighter" }, pending: thread.messages, resume: false, viewing: "screens/a", lang: "en" });
  assert.match(p, /Thread t_9 · version ban-2 · the whole design/);
  assert.match(p, /looking at screens\/a/);
  const none = buildPrompt({ thread, meta: { title: "Tighter" }, pending: thread.messages, resume: false, viewing: null, lang: "en" });
  assert.ok(!/looking at/.test(none));
  const vi = buildPrompt({ thread, meta: { title: "x" }, pending: thread.messages, resume: false, viewing: null, lang: "vi" });
  assert.match(vi, /toàn bộ thiết kế/);
});

test("progressOf: replace, browse and run are named for the UI", () => {
  const ev = (name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", name: `mcp__studio__${name}`, input }] } });
  assert.deepEqual(progressOf(ev("replace", { pattern: "p-3" })), { key: "replacing", params: { pattern: "p-3" } });
  assert.deepEqual(progressOf(ev("browse", { all: true })), { key: "browsing", params: { what: "all" } });
  assert.deepEqual(progressOf(ev("browse", { frames: [{ entry: "screens/a" }, { entry: "screens/b" }] })), { key: "browsing", params: { what: "2" } });
  assert.deepEqual(progressOf(ev("run", { command: "node x.js" })), { key: "running", params: { command: "node x.js" } });
});

test("runAgent: a design turn offers run only with a sandbox, and the design tools are always there", async () => {
  const seen = [];
  const q = ({ options }) => { seen.push(options.allowedTools); return (async function* () { yield { type: "result", subtype: "success", result: "ok", total_cost_usd: 0 }; })(); };
  await runAgent({ root: ROOT, model: "sonnet", prompt: "P", ctx: { version: "ban-1", threadId: "t_1", entry: null }, shots: {}, design: true, sandbox: { backend: "process", run() {} }, queryImpl: q });
  await runAgent({ root: ROOT, model: "sonnet", prompt: "P", ctx: { version: "ban-1", threadId: "t_1", entry: null }, shots: {}, design: true, sandbox: null, queryImpl: q });
  assert.ok(seen[0].includes("mcp__studio__run") && seen[0].includes("mcp__studio__replace") && seen[0].includes("mcp__studio__browse"));
  assert.ok(!seen[1].includes("mcp__studio__run") && seen[1].includes("mcp__studio__replace"));
});

// ── mentions: the person names screens with @[id] ──
test("buildPrompt: the screens mentioned in the new messages are listed, so Claude looks at them before it changes anything", () => {
  const thread = { id: "t_9", entry: "*", version: "ban-2", title: "T", messages: [
    { id: "m1", role: "user", author: "ana", text: "make @[screens/a] denser, like @[screens/b~opt-1]", refs: [], images: [] },
    { id: "m2", role: "user", author: "ana", text: "and @[screens/a] again, not @[../x]", refs: [], images: [] },
  ] };
  const p = buildPrompt({ thread, meta: { title: "T" }, pending: thread.messages, resume: false, viewing: null, lang: "en" });
  assert.match(p, /Screens mentioned in the new messages: screens\/a, screens\/b~opt-1 — look at them before you change anything\./);
  const vi = buildPrompt({ thread, meta: { title: "T" }, pending: thread.messages, resume: true, viewing: null, lang: "vi" });
  assert.match(vi, /Các màn được nhắc trong tin mới: screens\/a, screens\/b~opt-1 — hãy xem chúng trước khi sửa\./);
  const none = { ...thread, messages: [{ id: "m1", role: "user", author: "ana", text: "hello", refs: [], images: [] }] };
  assert.ok(!/mentioned/.test(buildPrompt({ thread: none, meta: { title: "T" }, pending: none.messages, resume: false, viewing: null, lang: "en" })));
  // A thread of one screen gets the same line.
  const legacy = { ...thread, entry: "screens/a" };
  assert.match(buildPrompt({ thread: legacy, meta: { title: "T" }, pending: legacy.messages, resume: false, lang: "en" }), /Screens mentioned in the new messages/);
});

test("designSystemPrompt: tells Claude how a screen is mentioned and that its reply may mention screens the same way", () => {
  const en = designSystemPrompt({ project: { name: "Acme", description: "", language: "en", source: null }, topics: ["boards"], sandbox: false });
  assert.match(en, /@\[screen-id\]/);
  const vi = designSystemPrompt({ project: { name: "Acme", description: "", language: "vi", source: null }, topics: ["boards"], sandbox: false });
  assert.match(vi, /@\[screen-id\]/);
});

test("designSystemPrompt: edit the screens in place; an option only when the person asks (their «new version» is an option); never a new version", () => {
  const en = designSystemPrompt({ project: { name: "Acme", description: "", language: "en", source: null }, topics: ["boards"], sandbox: false });
  assert.match(en, /edit them in place, whatever their status/);
  assert.match(en, /Make an option .* only when the person asks for one/);
  assert.match(en, /a change that reaches several screens is one option, under the same name on each of them/);
  assert.match(en, /Never make or propose a new version of the whole design/);
  assert.doesNotMatch(en, /Option A — /);
  const vi = designSystemPrompt({ project: { name: "Acme", description: "", language: "vi", source: null }, topics: ["boards"], sandbox: false });
  assert.match(vi, /Chỉ tạo phương án .* khi người dùng nhờ/);
  assert.match(vi, /Không bao giờ tạo hay đề xuất phiên bản mới/);
  assert.match(vi, /Hướng A — /);
});

test("read-only tools are marked so the calls of one step that only look run at once; tools that write are not", async () => {
  const { READ_ONLY_TOOLS, toolExtras, TOOL_NAMES: names } = await import("./agent.mjs");
  const all = [...names, ...DESIGN_NAMES];
  const writing = ["edit", "write", "replace", "run"];
  assert.deepEqual(all.filter((n) => !READ_ONLY_TOOLS.has(n)).sort(), [...writing].sort(), "every tool is either read-only or one of the writing ones");
  assert.ok([...READ_ONLY_TOOLS].every((n) => all.includes(n)));
  assert.deepEqual(toolExtras("view_frame"), { annotations: { readOnlyHint: true } });
  for (const n of writing) assert.equal(toolExtras(n), undefined);
  // The SDK keeps the hint on the tool it hands to Claude Code (which runs read-only MCP tools concurrently).
  const { tool } = await import("@anthropic-ai/claude-agent-sdk");
  assert.deepEqual(tool("browse", "d", {}, async () => ({ content: [] }), toolExtras("browse")).annotations, { readOnlyHint: true });
});

test("compact window: 200k by default, tokens / 200k / 1m, clamped to 100k–1M, auto = the SDK's own; only CLAUDE_CODE_AUTO_COMPACT_WINDOW reaches Claude", async () => {
  const { compactWindow, agentEnv } = await import("./agent.mjs");
  assert.equal(compactWindow(undefined), 200_000);
  assert.equal(compactWindow(""), 200_000);
  assert.equal(compactWindow("150000"), 150_000);
  assert.equal(compactWindow("300k"), 300_000);
  assert.equal(compactWindow("1m"), 1_000_000);
  assert.equal(compactWindow("20k"), 100_000);
  assert.equal(compactWindow("5m"), 1_000_000);
  assert.equal(compactWindow("lots"), 200_000);
  assert.equal(compactWindow("AUTO"), null);
  const env = agentEnv({ PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "t", CLAUDECODE: "1", CLAUDE_CODE_AUTO_COMPACT_WINDOW: "999999", STUDIO_AGENT_COMPACT_WINDOW: "150k" });
  assert.deepEqual(env, { PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "t", STUDIO_AGENT_COMPACT_WINDOW: "150k", CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" });
  assert.equal(agentEnv({ STUDIO_AGENT_COMPACT_WINDOW: "auto" }).CLAUDE_CODE_AUTO_COMPACT_WINDOW, undefined);
});

test("progressOf: the SDK compacting the conversation → «compacting»", () => {
  assert.deepEqual(progressOf({ type: "system", subtype: "status", status: "compacting" }), { key: "compacting" });
  assert.equal(progressOf({ type: "system", subtype: "status", status: null }), null);
});

test("sdkOptions: effort is passed to the SDK only when one was chosen", () => {
  assert.equal(sdkOptions({ model: "sonnet", mcpServer: {}, systemPrompt: "P", effort: "xhigh" }).effort, "xhigh");
  assert.ok(!("effort" in sdkOptions({ model: "sonnet", mcpServer: {}, systemPrompt: "P" })), "no effort chosen → the model's own default");
});
