// retry() of tests/lib/retry.mjs: tests/lib/e2e.mjs starts Chrome through it (a start can crash on a busy machine).
import { test } from "node:test";
import assert from "node:assert/strict";
import { retry } from "./lib/retry.mjs";

test("retry: the first success is returned; failures before it are reported, then retried", async () => {
  let n = 0;
  const seen = [];
  const out = await retry(async () => { if (++n < 3) throw new Error(`crash ${n}`); return "up"; }, { tries: 3, wait: 0, onRetry: (e, i) => seen.push(`${i}: ${e.message}`) });
  assert.equal(out, "up");
  assert.equal(n, 3);
  assert.deepEqual(seen, ["1: crash 1", "2: crash 2"]);
});

test("retry: after the last try the last error is thrown", async () => {
  let n = 0;
  await assert.rejects(retry(async () => { throw new Error(`crash ${++n}`); }, { tries: 2, wait: 0 }), /crash 2/);
  assert.equal(n, 2);
});
