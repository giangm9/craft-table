// Model and effort of a turn, through threads-api with a FAKE Claude: the thread's choice reaches runAgent, a session is
// resumed only for the same model, and the model a turn ran with is remembered.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createThreadsApi } from "../threads-api.mjs";
import { addMessage, newThread, saveThread, loadThread, setAgent } from "./threads.mjs";
import { modelChoices } from "./run-options.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 3000, what = "condition") {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await fn()) return; await wait(20); }
  throw new Error(`timed out waiting for ${what}`);
}

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tr-"));
  fs.mkdirSync(path.join(root, "versions", "ban-1", "boards", "screens"), { recursive: true });
  const dir = path.join(root, "threads");
  const calls = [];
  const runAgent = (args) => { calls.push(args); return Promise.resolve({ ok: true, text: "ok", costUsd: 0 }); };
  const choices = modelChoices({ STUDIO_AGENT_MODEL: "claude-sonnet-5-5" });
  const api = createThreadsApi({
    root, hot: { send() {} }, listEntries: () => [], live: () => "ban-1", pickVersion: (v) => v,
    readBody: async () => ({}), send() {}, model: choices.defaultModel.id, models: choices.models, runAgent, shots: {},
    buildPrompt: ({ thread }) => `[${thread.id}]`,
  });
  t.after(() => api.close());
  let n = 0;
  const mk = async (over = {}, agent = {}) => {
    const id = `t_${(++n).toString(36)}r${Math.random().toString(36).slice(2, 6)}`;
    let th = { ...newThread({ entry: "screens/a", version: "ban-1", title: "T", author: "u@x" }, { id, now: new Date().toISOString() }).thread, ...over };
    th = addMessage(th, { role: "user", author: "u@x", text: "go", refs: [] }, { id: `m_${id}`, now: new Date().toISOString() }).thread;
    th = setAgent(th, agent);
    await saveThread(dir, th);
    return id;
  };
  const turn = async (id) => { const before = calls.length; api.startAgent(id); await waitFor(() => calls.length > before, 2000, "a turn"); await waitFor(async () => (await loadThread(dir, id)).agent.state === "idle", 2000, "idle"); return calls.at(-1); };
  return { dir, mk, turn };
}

test("a thread with no choice runs with the studio's default model and no effort", async (t) => {
  const s = setup(t);
  const c = await s.turn(await s.mk());
  assert.equal(c.model, "claude-sonnet-5-5");
  assert.equal(c.effort, undefined);
});

test("the thread's model and effort reach the turn; a model that is not offered falls back to the default", async (t) => {
  const s = setup(t);
  const c = await s.turn(await s.mk({ runWith: { model: "claude-opus-5-5", effort: "max" } }));
  assert.deepEqual([c.model, c.effort], ["claude-opus-5-5", "max"]);
  const gone = await s.turn(await s.mk({ runWith: { model: "claude-retired-1", effort: "high" } }));
  assert.deepEqual([gone.model, gone.effort], ["claude-sonnet-5-5", "high"]);
});

test("a session is resumed only for the same model (a new model reads the conversation itself); a thread from before keeps resuming", async (t) => {
  const s = setup(t);
  const sess = { sessionId: "s-1", sessionKind: "sandbox" };
  const same = await s.turn(await s.mk({ runWith: { model: "claude-opus-5-5" } }, { ...sess, lastModel: "claude-opus-5-5" }));
  assert.equal(same.sessionId, "s-1", "same model → resume");
  const changed = await s.turn(await s.mk({ runWith: { model: "claude-opus-5-5" } }, { ...sess, lastModel: "claude-sonnet-5-5" }));
  assert.equal(changed.sessionId ?? null, null, "another model → a new session");
  const effortOnly = await s.turn(await s.mk({ runWith: { model: "claude-sonnet-5-5", effort: "low" } }, { ...sess, lastModel: "claude-sonnet-5-5" }));
  assert.equal(effortOnly.sessionId, "s-1", "a different effort alone keeps the session");
  const old = await s.turn(await s.mk({}, sess));
  assert.equal(old.sessionId, "s-1", "a thread that never recorded its model still resumes");
});

test("the model a turn ran with is remembered on the thread", async (t) => {
  const s = setup(t);
  const id = await s.mk({ runWith: { model: "claude-haiku-5-5", effort: "low" } });
  await s.turn(id);
  const th = await loadThread(s.dir, id);
  assert.equal(th.agent.lastModel, "claude-haiku-5-5");
  assert.equal(th.agent.lastEffort, "low");
});
