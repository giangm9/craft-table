// Whole-design threads through threads-api with a FAKE Claude: the turn holds the whole version, its ctx has no screen
// unless the person said which one they were looking at, and it runs with the design settings.
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

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "td-"));
  fs.mkdirSync(path.join(root, "versions", "ban-1", "boards", "screens"), { recursive: true });
  const dir = path.join(root, "threads");
  const started = [], finish = {}, calls = {};
  const runAgent = (args) => {
    const id = args.prompt.match(/t_[a-z0-9]+/)[0];
    calls[id] = args;
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    done.stop = () => resolve({ ok: false, error: { key: "stoppedByUser" } });
    started.push(id);
    finish[id] = (text) => resolve({ ok: true, text: text ?? `done ${id}` });
    return done;
  };
  const sandbox = { backend: "process", run() {} };
  const api = createThreadsApi({
    root, hot: { send() {} }, listEntries: () => [], live: () => "ban-1", pickVersion: (v) => v,
    readBody: async () => ({}), send() {}, model: "x", runAgent, shots: {}, sandbox,
    buildPrompt: ({ thread }) => `[${thread.id}]`,
  });
  t.after(() => api.close());
  let n = 0;
  const mk = async (entry, over = {}) => {
    const id = `t_${(++n).toString(36)}z${Math.random().toString(36).slice(2, 6)}`;
    const th = newThread({ entry, version: "ban-1", title: "T", author: "u@x" }, { id, now: new Date().toISOString() }).thread;
    const m = addMessage(th, { role: "user", author: "u@x", text: "do it", refs: [], ...over }, { id: `m_${id}`, now: new Date().toISOString() });
    await saveThread(dir, m.thread);
    return id;
  };
  return { root, dir, api, mk, started, finish, calls, state: async (id) => (await loadThread(dir, id))?.agent?.state };
}

test("a design turn runs in design mode with the sandbox, and without a screen when none was viewed", async (t) => {
  const s = setup(t);
  const d = await s.mk("*");
  s.api.startAgent(d);
  await waitFor(() => s.started.includes(d), 2000, "design turn runs");
  assert.equal(s.calls[d].design, true);
  assert.equal(s.calls[d].sandbox.backend, "process");
  assert.equal(s.calls[d].ctx.entry, null);
  assert.equal(s.calls[d].ctx.version, "ban-1");
  assert.ok(s.calls[d].timeoutMs >= 30 * 60_000, "a long turn");
  s.finish[d]("Done @mark(-, desktop, 1, 2, 3, 4)");
  await waitFor(async () => (await s.state(d)) === "idle", 2000, "done");
  const reply = (await loadThread(s.dir, d)).messages.at(-1);
  assert.equal(reply.role, "claude");
  assert.deepEqual(reply.refs, [], "no screen to mark → marks dropped, the reply is still stored");
  assert.equal(reply.text, "Done");
});

test("a design turn that was told which screen the person looks at gets it as ctx.entry, and marks land on that screen", async (t) => {
  const s = setup(t);
  const d = await s.mk("*", { viewing: "screens/a" });
  s.api.startAgent(d);
  await waitFor(() => s.started.includes(d), 2000);
  assert.equal(s.calls[d].ctx.entry, "screens/a");
  s.finish[d]("Look @mark(-, desktop, 1, 2, 3, 4)");
  await waitFor(async () => (await s.state(d)) === "idle", 2000);
  assert.equal((await loadThread(s.dir, d)).messages.at(-1).refs[0].entry, "screens/a");
});

test("a screen thread is NOT a design turn (no design flag, normal time limit)", async (t) => {
  const s = setup(t);
  const a = await s.mk("screens/a");
  s.api.startAgent(a);
  await waitFor(() => s.started.includes(a), 2000);
  assert.ok(!s.calls[a].design);
  s.finish[a]();
  await waitFor(async () => (await s.state(a)) === "idle", 2000);
});

test("the design turn takes the whole version: it waits for a running screen turn, and a screen turn queued after it waits behind it", async (t) => {
  const s = setup(t);
  const a = await s.mk("screens/a"), d = await s.mk("*"), b = await s.mk("screens/b");
  s.api.startAgent(a);
  await waitFor(() => s.started.includes(a), 2000, "A runs");
  s.api.startAgent(d);
  await wait(60);
  assert.equal(s.started.includes(d), false, "design waits for the screen turn");
  assert.equal(await s.state(d), "queued");
  s.api.startAgent(b);
  await wait(60);
  assert.equal(s.started.includes(b), false, "B (queued after the design turn) waits too");
  s.finish[a]();
  await waitFor(() => s.started.includes(d), 2000, "design runs after A");
  assert.equal(s.started.includes(b), false);
  s.finish[d]();
  await waitFor(() => s.started.includes(b), 2000, "B runs after the design turn");
  s.finish[b]();
  await waitFor(async () => (await s.state(b)) === "idle", 2000);
});
