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
