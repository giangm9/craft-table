// Claude's per-screen queue, run through threads-api with a FAKE Claude (runAgent injected): the real Claude is never called.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createThreadsApi } from "../threads-api.mjs";
import { addMessage, newThread, saveThread, loadThread } from "./threads.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 3000, what = "condition") {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await fn()) return; await wait(20); }
  throw new Error(`timed out waiting for ${what}`);
}

function setup(t, over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tq-"));
  fs.mkdirSync(path.join(root, "versions", "ban-1", "boards", "screens"), { recursive: true });
  const dir = path.join(root, "threads");
  // Fake Claude: each turn hangs until the test finishes it (finish[threadId]()).
  const started = [], finish = {}, stopped = [], ctxs = {}, shotsSeen = [], sessions = {}, prompts = {};
  const shots = { fake: "shots" };
  const runAgent = ({ prompt, ctx, shots: sh, sessionId, onSession }) => {
    const id = /\[luồng (t_[a-z0-9]+)\]/.exec(prompt)?.[1] ?? prompt.match(/t_[a-z0-9]+/)?.[0];
    ctxs[id] = ctx;
    prompts[id] = prompt;
    shotsSeen.push(sh);
    (sessions[id] ??= []).push(sessionId ?? null);
    onSession?.(`s-moi-${id}`);
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    done.stop = () => { stopped.push(id); resolve({ ok: false, error: { key: "stoppedByUser" } }); }; // as lib/agent.mjs
    started.push(id);
    finish[id] = (text) => resolve({ ok: true, text: text ?? `xong ${id}` });
    return done;
  };
  const api = createThreadsApi({
    root, hot: { send() {} }, listEntries: () => [], live: () => "ban-1", pickVersion: (v) => v,
    readBody: async () => ({}), send() {}, model: "x", runAgent, shots,
    buildPrompt: ({ thread }) => `[luồng ${thread.id}]`,
    ...over,
  });
  t.after(() => api.close());
  let n = 0;
  const mk = async (entry, version = "ban-1") => {
    const id = `t_${(++n).toString(36)}x${Math.random().toString(36).slice(2, 6)}`;
    const t = newThread({ entry, version, title: "T", author: "u@x" }, { id, now: new Date().toISOString() }).thread;
    const m = addMessage(t, { role: "user", author: "u@x", text: "sửa giúp", refs: [] }, { id: `m_${id}`, now: new Date().toISOString() });
    await saveThread(dir, m.thread);
    return id;
  };
  const state = async (id) => (await loadThread(dir, id))?.agent?.state;
  return { root, dir, api, mk, started, finish, stopped, state, ctxs, shots, shotsSeen, sessions, prompts };
}

test("a message sent while viewing an OPTION → Claude's turn works on that option (ctx.entry); marks Claude returns record that screen", async (t) => {
  const s = setup(t);
  const a = await s.mk("screens/a");
  const x = await loadThread(s.dir, a);
  const m = addMessage(x, { role: "user", author: "u@x", text: "sửa phương án", refs: [], viewing: "screens/a~ba-nut" }, { id: "m_2", now: new Date().toISOString() });
  await saveThread(s.dir, m.thread);
  s.api.startAgent(a);
  await waitFor(() => s.started.includes(a), 2000, "A runs");
  assert.equal(s.ctxs[a].entry, "screens/a~ba-nut");
  s.finish[a]("Đây @khoanh(-, desktop, 1, 2, 30, 40)");
  await waitFor(async () => (await s.state(a)) === "idle", 2000, "A done");
  const reply = (await loadThread(s.dir, a)).messages.at(-1);
  assert.equal(reply.role, "claude");
  assert.equal(reply.refs[0].entry, "screens/a~ba-nut");
});

test("an old thread still holding a session from the old way of running Claude (no sandbox mark) → NOT resumed, a new session is opened; the new session is marked and the next turn resumes it", async (t) => {
  const s = setup(t);
  const a = await s.mk("screens/a");
  const old = await loadThread(s.dir, a);
  await saveThread(s.dir, { ...old, agent: { ...old.agent, sessionId: "phien-claude-p-cu" } });
  s.api.startAgent(a);
  await waitFor(() => s.started.includes(a), 2000, "A runs");
  assert.deepEqual(s.sessions[a], [null], "the old session is not resumed");
  s.finish[a]();
  await waitFor(async () => (await s.state(a)) === "idle", 2000, "A done");
  const after = await loadThread(s.dir, a);
  assert.equal(after.agent.sessionId, `s-moi-${a}`);
  assert.equal(after.agent.sessionKind, "sandbox");
  // A new message → the next turn resumes exactly the sandbox session just created.
  const m = addMessage(after, { role: "user", author: "u@x", text: "thêm nữa", refs: [] }, { id: "m_2", now: new Date().toISOString() });
  await saveThread(s.dir, m.thread);
  s.started.length = 0;
  s.api.startAgent(a);
  await waitFor(() => s.started.includes(a), 2000, "A runs turn 2");
  assert.deepEqual(s.sessions[a], [null, `s-moi-${a}`]);
  s.finish[a]();
  await waitFor(async () => (await s.state(a)) === "idle", 2000, "A done with turn 2");
});

test("Claude gets the CONTEXT of the right thread (locks the sandbox toolset) + the shared screenshot taker", async (t) => {
  const s = setup(t);
  const a = await s.mk("screens/a", "ban-1");
  s.api.startAgent(a);
  await waitFor(() => s.started.includes(a), 2000, "A runs");
  assert.deepEqual(s.ctxs[a], { version: "ban-1", threadId: a, entry: "screens/a" });
  assert.equal(s.shotsSeen[0], s.shots);
  s.finish[a]();
  await waitFor(async () => (await s.state(a)) === "idle", 2000, "A done");
});

test("2 threads on the same screen: the later one is 'queued' until the earlier one is done; another screen runs right away", async (t) => {
  const s = setup(t);
  const a = await s.mk("screens/a"), b = await s.mk("screens/a"), c = await s.mk("screens/c");
  s.api.startAgent(a);
  await waitFor(() => s.started.includes(a), 2000, "A runs");
  s.api.startAgent(b);
  s.api.startAgent(c);
  await waitFor(() => s.started.includes(c), 2000, "C (another screen) to run right away");
  await waitFor(async () => (await s.state(b)) === "queued", 2000, "B to wait");
  const tb = await loadThread(s.dir, b);
  assert.deepEqual(tb.agent.progress, { key: "queued" }, "stored as a key: each viewer reads it in their own language");
  assert.deepEqual((await loadThread(s.dir, a)).agent.progress, { key: "readingConversation" });
  assert.ok(!s.started.includes(b), "B does not run while A still holds the screen");
  s.finish[a]();
  await waitFor(() => s.started.includes(b), 2000, "B to run after A is done");
  assert.equal(await s.state(b), "running");
  s.finish[b](); s.finish[c]();
  await waitFor(async () => (await s.state(b)) === "idle" && (await s.state(c)) === "idle", 2000, "B and C done");
});

test("Stop while waiting → the place in the queue is cancelled, no run; the next thread still gets its turn", async (t) => {
  const s = setup(t);
  const a = await s.mk("screens/a"), b = await s.mk("screens/a"), d = await s.mk("screens/a");
  s.api.startAgent(a);
  await waitFor(() => s.started.includes(a));
  s.api.startAgent(b);
  s.api.startAgent(d);
  await waitFor(async () => (await s.state(b)) === "queued" && (await s.state(d)) === "queued", 2000, "B and D to wait");
  await s.api.stop(b);
  await waitFor(async () => (await s.state(b)) === "idle", 2000, "B back to idle when stopped while waiting");
  s.finish[a]();
  await waitFor(() => s.started.includes(d), 2000, "D's turn");
  assert.ok(!s.started.includes(b), "B was cancelled, so it does not run");
  s.finish[d]();
});

test("restarting the studio while a thread is waiting → an error with a Run again button (like a running turn)", async (t) => {
  const s = setup(t);
  const a = await s.mk("screens/a");
  const th = await loadThread(s.dir, a);
  await saveThread(s.dir, { ...th, agent: { ...th.agent, state: "queued", progress: "Chờ…" } });
  await s.api.recover();
  const after = await loadThread(s.dir, a);
  assert.equal(after.agent.state, "error");
  assert.deepEqual(after.agent.error, { key: "restarted" });
});

// ── Languages: what a viewer reads follows their language (ct_lang cookie, else the project's); what Claude's turn
// stores follows the project's. ─────────────────────────────────────────────────────────────────────────────────
/** threads-api of a project in `language`; call(method, path, { json, cookie }) → what `send` got: { status, body }. */
function withApi(t, language) {
  let body = {}, out = null;
  const s = setup(t, { project: { name: "P", language }, readBody: async () => body, send: (_res, status, b) => { out = { status, body: b }; } });
  const call = async (method, pathname, { json = {}, cookie } = {}) => {
    body = json;
    out = null;
    const headers = { "content-type": "application/json", ...(cookie ? { cookie } : {}) };
    await s.api.handle({ method, headers }, {}, new URL(`http://studio${pathname}`), "claude@local");
    return out;
  };
  return { ...s, call };
}
const untitled = { entry: "screens/a", text: "[#1]", noAgent: true }; // no title, and no words to name it after

test("a new thread with nothing to name it after gets the default title in its creator's language", async (t) => {
  const en = withApi(t, "en");
  const a = await en.call("POST", "/__api/threads", { json: untitled });
  assert.equal(a.status, 201);
  assert.equal(a.body.thread.title, "New thread");
  assert.equal((await en.call("POST", "/__api/threads", { json: untitled, cookie: "ct_lang=vi" })).body.thread.title, "Luồng mới");
  const vi = withApi(t, "vi");
  assert.equal((await vi.call("POST", "/__api/threads", { json: untitled })).body.thread.title, "Luồng mới");
  assert.equal((await vi.call("POST", "/__api/threads", { json: untitled, cookie: "ct_lang=en" })).body.thread.title, "New thread");
  assert.equal((await vi.call("POST", "/__api/threads", { json: { ...untitled, text: "Nút gửi [#1] lệch" } })).body.thread.title, "Nút gửi lệch", "named after the first line");
});

test("API errors in the viewer's language, with their code", async (t) => {
  const en = withApi(t, "en");
  assert.deepEqual(await en.call("GET", "/__api/threads/t_nope1"), { status: 404, body: { error: "No such thread", code: "apiNoSuchThread" } });
  assert.deepEqual(await en.call("GET", "/__api/threads/t_nope1", { cookie: "ct_lang=vi" }), { status: 404, body: { error: "không có luồng này", code: "apiNoSuchThread" } });
  assert.deepEqual(await en.call("GET", "/__api/spec?entry=screens/a"), { status: 404, body: { error: "No spec yet", code: "apiNoSpec" } });
  const vi = withApi(t, "vi");
  assert.deepEqual(await vi.call("GET", "/__api/spec?entry=screens/a"), { status: 404, body: { error: "chưa có đặc tả", code: "apiNoSpec" } });
  assert.deepEqual(await vi.call("GET", "/__api/src?path=x.ts"), { status: 404, body: { error: "không có file", code: "apiNoFile" } });
  // A refusal of the thread lib keeps its Vietnamese words for a Vietnamese viewer.
  const bad = await vi.call("POST", "/__api/threads", { json: { ...untitled, entry: "../x" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "entry không hợp lệ");
});

test("Claude's empty reply is stored in the project's language (the conversation Claude reads back)", async (t) => {
  for (const [language, text] of [["en", "(No reply from Claude)"], ["vi", "(Claude không trả lời gì)"]]) {
    const s = withApi(t, language);
    const a = await s.mk("screens/a");
    s.api.startAgent(a);
    await waitFor(() => s.started.includes(a), 2000, "A runs");
    s.finish[a]("");
    await waitFor(async () => (await s.state(a)) === "idle", 2000, "A done");
    assert.equal((await loadThread(s.dir, a)).messages.at(-1).text, text, language);
  }
});

test("Claude's per-turn prompt is in the project's language", async (t) => {
  for (const [language, head] of [["en", "Thread "], ["vi", "Luồng "]]) {
    const s = setup(t, { project: { name: "P", language }, buildPrompt: undefined }); // the real buildPrompt
    const a = await s.mk("screens/a");
    s.api.startAgent(a);
    await waitFor(() => s.started.includes(a), 2000, "A runs");
    assert.ok(s.prompts[a].startsWith(head), `${language}: ${s.prompts[a].slice(0, 40)}`);
    s.finish[a]();
    await waitFor(async () => (await s.state(a)) === "idle", 2000, "A done");
  }
});

test("a turn that fails with a { key } error (stopped, timed out…) is stored as it is and does not retry as a lost session", async (t) => {
  const s = setup(t);
  const a = await s.mk("screens/a");
  const old = await loadThread(s.dir, a);
  await saveThread(s.dir, { ...old, agent: { ...old.agent, sessionId: "s-cu", sessionKind: "sandbox" } });
  s.api.startAgent(a);
  await waitFor(() => s.started.includes(a), 2000, "A runs");
  s.stopped.length = 0;
  await s.api.stop(a);
  await waitFor(async () => (await s.state(a)) === "error", 2000, "A to fail");
  assert.equal(s.sessions[a].length, 1, "no second attempt with a new session");
  const after = await loadThread(s.dir, a);
  assert.deepEqual(after.agent.error, { key: "stoppedByUser" });
  assert.equal(after.agent.progress, null);
});
