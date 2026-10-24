// Lifecycle of one e2e test file (tested in tests/lifecycle.test.mjs): one browser, clean-up steps that always run,
// then exit. "Always" includes an interrupt: Ctrl+C in a terminal sends SIGINT to the test process, and
// tests/run-e2e.mjs sends SIGTERM (Ctrl+C, test timeout). On either the browser is closed, requests the test already
// started are allowed to finish (so a version or thread being created gets its clean-up registered), the test may
// start no new request, and every clean-up runs — then the process exits 130. Clean-ups run once the browser is
// closed: removing files a page shows makes Vite reload it.
import { AsyncLocalStorage } from "node:async_hooks";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

/**
 * signals: where SIGINT/SIGTERM/SIGHUP arrive (process); exit(code): ends the process; out: console-like;
 * settleMs: how long requests started before an interrupt may take to finish.
 */
export function createLifecycle({ signals = process, exit = (code) => process.exit(code), out = console, settleMs = 15_000 } = {}) {
  const cleanups = [];
  const inflight = new Set();
  const inCleanup = new AsyncLocalStorage(); // set while a clean-up runs: its requests are allowed after an interrupt
  let interrupted = null; // signal name, once one arrived
  let finishing = null;

  /** Run a request (or any async step that changes the studio). After an interrupt only clean-ups may start one. */
  function track(fn) {
    if (interrupted && !inCleanup.getStore()) return Promise.reject(new Error(`✗ interrupted (${interrupted}): no new requests`));
    const p = Promise.resolve().then(fn);
    inflight.add(p);
    p.then(() => inflight.delete(p), () => inflight.delete(p));
    return p;
  }

  async function settle() {
    let timer;
    await Promise.race([Promise.allSettled([...inflight]), new Promise((r) => { timer = setTimeout(r, settleMs); })]);
    clearTimeout(timer);
    await new Promise((r) => setImmediate(r)); // let the test register the clean-up of what those requests made
  }

  async function run(name, body, { launch }) {
    const browser = await launch();
    // Once, whichever comes first: the test ends, fails, or is interrupted.
    const finish = (code) => (finishing ??= (async () => {
      await browser.close().catch(() => {});
      if (interrupted) await settle();
      let failed = code !== 0;
      while (cleanups.length) {
        const [what, fn] = cleanups.pop(); // newest first; one registered meanwhile still runs
        try { await inCleanup.run(true, fn); } catch (e) { failed = true; out.error(`✗ clean-up failed (${what}): ${e?.message ?? e}`); }
      }
      exit(interrupted ? 130 : failed ? 1 : 0);
    })());
    const onSignal = (sig) => {
      if (interrupted || finishing) return;
      interrupted = sig;
      out.error(`✗ ${name} interrupted (${sig}) — closing the browser and cleaning up`);
      finish(130);
    };
    for (const s of SIGNALS) signals.on(s, onSignal);
    try {
      await body({ browser, cleanup: (what, fn) => cleanups.push([what, fn]) });
      if (!interrupted) out.log(`DONE ${name}`);
      await finish(0);
    } catch (e) {
      if (!interrupted) out.error(e?.message?.startsWith("✗") ? e.message : e);
      await finish(1);
    }
  }

  return { run, track };
}
