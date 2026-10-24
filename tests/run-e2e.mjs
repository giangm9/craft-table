#!/usr/bin/env node
// End-to-end tests of the studio, run on the example project:
//   1. start `craft-table start` on port 5190 (or STUDIO_PORT) with CRAFT_PROJECT=<repo>/example — refuses to run
//      when that port is taken; the studio gets no Claude credentials (lib/runner.mjs studioEnv)
//   2. wait until it answers, then open it once in a browser so Vite has compiled the studio and the boards
//   3. run every tests/*.e2e.mjs one after another, each with STUDIO=<its address>
//   4. print a summary, stop the studio; exit 1 if any test failed, or if the run left files in the example project
//   node tests/run-e2e.mjs                  all tests
//   node tests/run-e2e.mjs composer spec    only the files whose name contains one of the words
// Ctrl+C (or SIGTERM): the running test closes its browser and removes what it created (lib/lifecycle.mjs); the runner
// waits for that, then stops the studio and exits 130. A second Ctrl+C stops at once. The studio runs in its own
// process group so a terminal's Ctrl+C does not stop it before the test has cleaned up. tests/interrupt-check.mjs
// checks all this on a real run. Before starting, the runner warns about leftovers of an earlier run (a version other
// than the live one, options, threads); after the run, any file added, changed or removed in the project fails it.
// Screenshots go to tests/shots/. The studio's own output goes to the system temp folder (craft-table-e2e-studio-<port>.log):
// it holds this machine's absolute paths (Vite prints them with compile errors), which do not belong in the repo folder.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { changes, pickTests, snapshot, stopChild, strays, studioEnv, summary, testEnv } from "./lib/runner.mjs";

const TESTS = import.meta.dirname;
const REPO = path.resolve(TESTS, "..");
const PROJECT = path.join(REPO, "example");
const PORT = Number(process.env.STUDIO_PORT || 5190);
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_TIMEOUT = Number(process.env.E2E_TEST_TIMEOUT_MS || 10 * 60_000);
const CLEANUP_MS = 60_000; // how long a stopped test may take to close its browser and clean up
const LOG = path.join(os.tmpdir(), `craft-table-e2e-studio-${PORT}.log`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { files, unmatched } = pickTests(fs.readdirSync(TESTS), process.argv.slice(2));
if (unmatched.length) { console.error(`no test file matches: ${unmatched.join(", ")}`); process.exit(2); }
if (!files.length) { console.error("no tests/*.e2e.mjs found"); process.exit(2); }
if (!fs.existsSync(path.join(PROJECT, "craft-table.json"))) { console.error(`no example project at ${PROJECT} (craft-table.json missing)`); process.exit(2); }

const taken = await new Promise((resolve) => {
  const s = net.connect(PORT, "127.0.0.1");
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
});
if (taken) { console.error(`port ${PORT} is already in use — stop whatever runs there (a studio left by an earlier run?), or set STUDIO_PORT`); process.exit(2); }

// Leftovers of an earlier run (one that was killed): not part of the shipped example, and `git add example` would
// commit them. Warned about here; what this run leaves is compared against `before` at the end.
const stray = strays(PROJECT);
if (stray.length) console.log(`! the example project holds what the shipped example never has — left by an earlier run? Remove before committing:\n    ${stray.join("\n    ")}`);
const before = snapshot(PROJECT);
/** Files this run added, changed or removed in the project (printed); true when there are none. */
function projectUntouched() {
  const left = changes(before, snapshot(PROJECT));
  if (left.length) console.error(`✗ the run left the example project changed:\n    ${left.join("\n    ")}`);
  return left.length === 0;
}

// ── Studio ──
fs.mkdirSync(path.join(TESTS, "shots"), { recursive: true });
const log = fs.openSync(LOG, "w");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "craft-table-e2e-home-"));
// Own process group (detached): a terminal's Ctrl+C reaches the runner and the test, not the studio — the test's
// clean-ups need it. The runner stops it on every way out (below, and on exit as a last resort).
const studio = spawn(process.execPath, [path.join(REPO, "bin", "craft-table.mjs"), "start"], {
  cwd: PROJECT,
  env: studioEnv(process.env, { project: PROJECT, port: PORT, home }),
  stdio: ["ignore", log, log],
  detached: true,
});
let exited = null;
const gone = new Promise((resolve) => {
  studio.on("exit", (code, signal) => { exited = { code, signal }; resolve(); });
  studio.on("error", (e) => { exited = { code: e.code }; resolve(); });
});

process.on("exit", () => { if (!exited) studio.kill("SIGTERM"); });

async function stopStudio() {
  if (!exited) {
    await stopChild(studio, 15_000); // the studio closes its databases and Vite on SIGTERM
    await gone;
  }
  fs.rmSync(home, { recursive: true, force: true });
}
let current = null; // test process running now
let interrupted = false;
const never = () => new Promise(() => {}); // after an interrupt the signal handler ends the process
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, async () => {
    if (interrupted) { // second Ctrl+C: stop now, clean-ups or not
      console.error("✗ stopping now — the running test may not have cleaned up");
      current?.kill("SIGKILL");
      studio.kill("SIGKILL");
      process.exit(130);
    }
    interrupted = true;
    console.error(`\n✗ interrupted (${sig})${current ? " — waiting for the running test to clean up (Ctrl+C again to stop now)" : ""}`);
    // The test got the terminal's SIGINT too; SIGTERM covers a signal sent to the runner alone. Either way it closes
    // its browser and runs its clean-ups against the studio, which is still up.
    if (current) await stopChild(current, CLEANUP_MS);
    await stopStudio();
    projectUntouched();
    process.exit(130);
  });
}
async function bail(msg) {
  if (interrupted) return never();
  console.error(`✗ ${msg}\n  studio log: ${LOG}`);
  await stopStudio();
  process.exit(1);
}

console.log(`studio: ${BASE} · project ${PROJECT}`);
const t0 = Date.now();
for (;;) {
  if (exited) await bail(`the studio stopped while starting (exit ${exited.code ?? exited.signal})`);
  try { if ((await fetch(`${BASE}/__api/entries`)).ok) break; } catch { /* not listening yet */ }
  if (Date.now() - t0 > 180_000) await bail("the studio did not answer within 3 minutes");
  await sleep(500);
}
console.log(`studio ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// Warm-up: the first visit makes Vite compile the studio UI, Tailwind and the boards (slow once, then cached).
// Tests start on a studio that answers at normal speed instead of the first one timing out.
{
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true, timeout: 120_000, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false, // the runner's own handlers stop the studio first
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 180_000 });
    await page.waitForFunction(() => {
      const frames = [...document.querySelectorAll("iframe")];
      return frames.length > 0 && frames.every((f) => f.contentDocument?.getElementById("root")?.children.length);
    }, { timeout: 180_000, polling: 500 });
    await page.goto(`${BASE}/spec?k=behavior&p=all&e=${encodeURIComponent((await (await fetch(`${BASE}/__api/entries`)).json()).entries[0]?.id ?? "")}`, { waitUntil: "load", timeout: 180_000 });
    console.log(`warm-up done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    if (!interrupted) console.log(`! warm-up incomplete (${String(e.message).slice(0, 120)}) — running the tests anyway`);
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── Tests, one after another ──
function runOne(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { cwd: REPO, env: testEnv(process.env, { studio: BASE, project: PROJECT }), stdio: "inherit" });
    current = child;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopChild(child, CLEANUP_MS); // the test closes its browser and cleans up on SIGTERM
    }, TEST_TIMEOUT);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      current = null;
      resolve(timedOut ? `timed out after ${Math.round(TEST_TIMEOUT / 60_000)} min` : code === 0 ? null : `exit ${code ?? signal}`);
    });
  });
}

const results = [];
for (const f of files) {
  if (interrupted) await never();
  if (exited) { results.push({ name: f, ok: false, ms: 0, why: "studio stopped" }); continue; }
  console.log(`\n── ${f} ──`);
  const t = Date.now();
  const why = await runOne(path.join(TESTS, f));
  results.push({ name: f, ok: !why, ms: Date.now() - t, why: why ?? undefined });
}
if (interrupted) await never();
await stopStudio();
const s = summary(results);
console.log(`\n${s.text}\nscreenshots: ${path.join(TESTS, "shots")}${s.ok ? "" : `\nstudio log: ${LOG}`}`);
const clean = projectUntouched();
process.exit(s.ok && clean ? 0 : 1);
