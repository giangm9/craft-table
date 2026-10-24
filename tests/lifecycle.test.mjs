// Lifecycle of one e2e test file (tests/lib/lifecycle.mjs, used by run() and api() in tests/lib/e2e.mjs): the
// browser is closed and every clean-up runs whether the test passes, fails, or is interrupted (Ctrl+C reaches the
// test process as SIGINT; the runner sends SIGTERM) — so an interrupted run leaves no version, option or thread behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createLifecycle } from "./lib/lifecycle.mjs";
import { LAUNCH_OPTIONS } from "./lib/e2e.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { timeout: 5_000 }; // a lifecycle that never exits fails here instead of hanging the run

/** A lifecycle with a fake process (signals), a fake browser and a recorded exit. */
function harness() {
  const log = [];
  const signals = new EventEmitter();
  let exited;
  const exit = new Promise((resolve) => { exited = resolve; });
  const browser = { close: async () => { log.push("browser closed"); } };
  const life = createLifecycle({ signals, exit: (code) => { log.push(`exit ${code}`); exited(code); }, out: { log: () => {}, error: () => {} } });
  const run = (body) => life.run("t", body, { launch: async () => browser });
  return { life, log, signals, exit, run };
}

test("Chrome is launched without Puppeteer's own signal handlers (they would exit before the clean-ups run)", () => {
  assert.equal(LAUNCH_OPTIONS.handleSIGINT, false);
  assert.equal(LAUNCH_OPTIONS.handleSIGTERM, false);
  assert.equal(LAUNCH_OPTIONS.handleSIGHUP, false);
});

test("a test that ends closes the browser, runs its clean-ups newest first, exits 0 — or 1 if it failed", T, async () => {
  const pass = harness();
  pass.run(async ({ cleanup }) => { cleanup("a", () => pass.log.push("a")); cleanup("b", () => pass.log.push("b")); });
  assert.equal(await pass.exit, 0);
  assert.deepEqual(pass.log, ["browser closed", "b", "a", "exit 0"]);

  const fail = harness();
  fail.run(async ({ cleanup }) => { cleanup("a", () => fail.log.push("a")); throw new Error("✗ boom"); });
  assert.equal(await fail.exit, 1);
  assert.deepEqual(fail.log, ["browser closed", "a", "exit 1"]);

  const badCleanup = harness();
  badCleanup.run(async ({ cleanup }) => { cleanup("a", () => { throw new Error("gone"); }); });
  assert.equal(await badCleanup.exit, 1, "a clean-up that fails fails the test");
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  test(`${sig} in the middle of a test: browser closed, every clean-up run (newest first), exit 130`, T, async () => {
    const h = harness();
    h.run(async ({ cleanup }) => {
      cleanup("version", () => h.log.push("version removed"));
      cleanup("thread", () => h.log.push("thread removed"));
      h.signals.emit(sig, sig);
      await new Promise(() => {}); // the test is stuck in a long wait: the interrupt must not depend on it
    });
    assert.equal(await h.exit, 130);
    assert.deepEqual(h.log, ["browser closed", "thread removed", "version removed", "exit 130"]);
  });
}

test("an interrupt during a request: the request finishes, and the clean-up the test then registers runs too", T, async () => {
  const h = harness();
  h.run(async ({ cleanup }) => {
    const made = h.life.track(async () => { await sleep(80); return "e2e-x"; }); // e.g. POST /__api/versions
    h.signals.emit("SIGINT", "SIGINT");
    const id = await made;
    cleanup(`version ${id}`, () => h.log.push(`removed ${id}`));
    await new Promise(() => {});
  });
  assert.equal(await h.exit, 130);
  assert.deepEqual(h.log, ["browser closed", "removed e2e-x", "exit 130"]);
});

test("after an interrupt the test cannot start new requests, but its clean-ups can", T, async () => {
  const h = harness();
  let refused = null;
  h.run(async ({ cleanup }) => {
    cleanup("thread", () => h.life.track(async () => { h.log.push("DELETE thread"); }));
    h.signals.emit("SIGINT", "SIGINT");
    try { await h.life.track(async () => { h.log.push("POST option"); }); } catch (e) { refused = e.message; }
    await new Promise(() => {});
  });
  assert.equal(await h.exit, 130);
  assert.match(refused ?? "", /interrupted/);
  assert.deepEqual(h.log, ["browser closed", "DELETE thread", "exit 130"]);
});

test("a second signal, or the test failing because its browser closed, does not run the clean-ups twice", T, async () => {
  const h = harness();
  let close;
  const browserGone = new Promise((r) => { close = r; });
  h.run(async ({ cleanup }) => {
    cleanup("thread", async () => { h.log.push("thread removed"); await sleep(50); });
    h.signals.emit("SIGINT", "SIGINT");
    h.signals.emit("SIGTERM", "SIGTERM");
    setTimeout(close, 10);
    await browserGone;
    throw new Error("Target closed"); // what a page call does once the browser is gone
  });
  assert.equal(await h.exit, 130);
  await sleep(100);
  assert.deepEqual(h.log, ["browser closed", "thread removed", "exit 130"]);
});
