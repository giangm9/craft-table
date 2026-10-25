import { test } from "node:test";
import assert from "node:assert/strict";
import { createQueue } from "./agent-queue.mjs";

const tick = () => new Promise((r) => setImmediate(r));

test("same screen: the second turn runs only after the first releases", async () => {
  const q = createQueue();
  const log = [];
  const r1 = await q.acquire("ban-1:a");
  log.push("1 in");
  const p2 = q.acquire("ban-1:a").then((rel) => { log.push("2 in"); return rel; });
  await tick();
  assert.deepEqual(log, ["1 in"]);
  assert.equal(q.busy("ban-1:a"), true);
  assert.equal(q.waiting("ban-1:a"), 1);
  r1();
  const r2 = await p2;
  assert.deepEqual(log, ["1 in", "2 in"]);
  assert.equal(q.waiting("ban-1:a"), 0);
  r2();
  assert.equal(q.busy("ban-1:a"), false);
});

test("another screen (or another version) runs in parallel", async () => {
  const q = createQueue();
  const a = await q.acquire("ban-1:a");
  let bIn = false, cIn = false;
  q.acquire("ban-1:b").then(() => { bIn = true; });
  q.acquire("ban-2:a").then(() => { cIn = true; });
  await tick();
  assert.equal(bIn && cIn, true);
  assert.equal(q.busy("ban-1:b"), true);
  a();
});

test("first in, first out; releasing twice does not let a later turn in early", async () => {
  const q = createQueue();
  const order = [];
  const r1 = await q.acquire("k");
  const p2 = q.acquire("k").then((r) => { order.push(2); return r; });
  const p3 = q.acquire("k").then((r) => { order.push(3); return r; });
  assert.equal(q.waiting("k"), 2);
  r1(); r1();
  const r2 = await p2;
  await tick();
  assert.deepEqual(order, [2], "turn 1's second release must not open the way for turn 3");
  assert.equal(q.waiting("k"), 1);
  r2();
  (await p3)();
  assert.deepEqual(order, [2, 3]);
  assert.equal(q.busy("k"), false);
  assert.equal(q.waiting("k"), 0);
});

// ── whole-design turns: key "<version>:*" holds the WHOLE version ──
test("design turn: waits for the running screen turns of its version, and a later screen turn waits behind it", async () => {
  const q = createQueue();
  const log = [];
  const a = await q.acquire("v1:a");
  const b = await q.acquire("v1:b");
  const d = q.acquire("v1:*").then((rel) => { log.push("design in"); return rel; });
  const c = q.acquire("v1:c").then((rel) => { log.push("c in"); return rel; }); // arrives AFTER the design turn: no jumping the line
  await tick();
  assert.deepEqual(log, []);
  assert.equal(q.busy("v1:*"), true);
  a();
  await tick();
  assert.deepEqual(log, [], "still waiting for b");
  b();
  const dr = await d;
  assert.deepEqual(log, ["design in"]);
  await tick();
  assert.deepEqual(log, ["design in"], "c waits while the design turn runs");
  dr();
  (await c)();
  assert.deepEqual(log, ["design in", "c in"]);
  assert.equal(q.busy("v1:c"), false);
});

test("design turn: another version is not blocked, and two design turns of one version take turns", async () => {
  const q = createQueue();
  const d1 = await q.acquire("v1:*");
  let other = false, second = false;
  q.acquire("v2:a").then(() => { other = true; });
  q.acquire("v2:*").then(() => { second = true; });
  const d1b = q.acquire("v1:*").then((rel) => { second = "v1 second"; return rel; });
  await tick();
  assert.equal(other, true, "a screen of another version runs at once");
  assert.equal(q.waiting("v1:*"), 1);
  d1();
  const rel = await d1b;
  assert.equal(second, "v1 second");
  rel();
  assert.equal(q.busy("v1:*"), false);
});

test("screen turns of one version still run in parallel when no design turn is around", async () => {
  const q = createQueue();
  await q.acquire("v1:a");
  let bIn = false;
  q.acquire("v1:b").then(() => { bIn = true; });
  await tick();
  assert.equal(bIn, true);
});
