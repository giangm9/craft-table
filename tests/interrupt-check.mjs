#!/usr/bin/env node
// Ctrl+C in the middle of an e2e run must leave the example project as it was. For each case: start
// tests/run-e2e.mjs on one test, in its own process group (like a terminal's foreground job), wait until the test has
// created what it removes at its end, send SIGINT to the whole group (what a terminal does on Ctrl+C), wait for the
// runner to exit, then compare every file of the project (except data/) with how it was before.
//   history        — a throwaway version (versions/e2e-…/ and versions/index.json)
//   option-thread  — an option in the live version (boards/…~<slug>.*) and a thread file (threads/)
// Any leftover fails the check; the project is then put back from a copy taken before the case started.
// --term: send SIGTERM to the runner alone instead (a supervisor or CI timeout stopping it).
//   node tests/interrupt-check.mjs [history] [option-thread] [--term]     (needs port 5190 free, like run-e2e.mjs)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { changes, snapshot, strays } from "./lib/runner.mjs";

const TESTS = import.meta.dirname;
const PROJECT = path.join(TESTS, "..", "example");
const CASES = {
  history: (s) => s.some((x) => x.startsWith("versions/e2e-")),
  "option-thread": (s) => s.some((x) => x.includes("~")) && s.some((x) => x.startsWith("threads/")),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERM = process.argv.includes("--term");
const args = process.argv.slice(2).filter((a) => a !== "--term");
const picked = args.length ? args : Object.keys(CASES);
for (const c of picked) if (!CASES[c]) { console.error(`unknown case ${c} — one of: ${Object.keys(CASES).join(", ")}`); process.exit(2); }
if (strays(PROJECT).length) { console.error(`the example project is not clean before the check:\n  ${strays(PROJECT).join("\n  ")}`); process.exit(2); }

/** Undo `left` (changes() lines) with the copy in `backup`: added files go (and folders they alone filled), others come back. */
function restore(backup, left) {
  for (const line of left) {
    const what = line.slice(0, line.indexOf(" ")), rel = line.slice(line.indexOf(" ") + 1);
    const dst = path.join(PROJECT, rel);
    if (what !== "added") { fs.cpSync(path.join(backup, rel), dst); continue; }
    fs.rmSync(dst, { force: true });
    for (let d = path.dirname(dst); d !== PROJECT && !fs.existsSync(path.join(backup, path.relative(PROJECT, d))) && fs.existsSync(d) && !fs.readdirSync(d).length; d = path.dirname(d)) fs.rmdirSync(d);
  }
}

let failed = 0;
for (const name of picked) {
  console.log(`\n══ ${name}: ${TERM ? "SIGTERM to the runner" : "Ctrl+C"} while the test runs ══`);
  const before = snapshot(PROJECT);
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), "craft-table-interrupt-"));
  fs.cpSync(PROJECT, backup, { recursive: true, filter: (src) => path.relative(PROJECT, src).split(path.sep)[0] !== "data" });
  const runner = spawn(process.execPath, [path.join(TESTS, "run-e2e.mjs"), name], { detached: true, stdio: "inherit" });
  const exited = new Promise((resolve) => runner.on("exit", (code, signal) => resolve(code ?? signal)));
  let code = null;
  runner.on("exit", (c, s) => { code = c ?? s; });

  const t0 = Date.now();
  while (code === null && !CASES[name](strays(PROJECT)) && Date.now() - t0 < 300_000) await sleep(100);
  let sent = false;
  if (code === null && CASES[name](strays(PROJECT))) {
    await sleep(1000); // well inside the test: its browser is up, its clean-ups are queued
    console.log(`\n>> ${TERM ? "SIGTERM to the runner" : "SIGINT to the runner's process group"} (${strays(PROJECT).join(", ")})`);
    if (TERM) runner.kill("SIGTERM"); else process.kill(-runner.pid, "SIGINT");
    sent = true;
  }
  const outcome = await Promise.race([exited, sleep(180_000).then(() => "still running after 3 min")]);
  if (outcome === "still running after 3 min") process.kill(-runner.pid, "SIGKILL");
  await sleep(500);

  const left = changes(before, snapshot(PROJECT));
  const ok = sent && left.length === 0;
  console.log(`\n${ok ? "✓" : "✗"} ${name}: runner exit ${outcome}${sent ? "" : " — the test never created what the case waits for"}`);
  if (left.length) {
    console.log(`  left in the project:\n    ${left.join("\n    ")}`);
    restore(backup, left);
    console.log(`  project put back as it was (${changes(before, snapshot(PROJECT)).length} differences now)`);
  }
  fs.rmSync(backup, { recursive: true, force: true });
  if (!ok) failed++;
}
console.log(`\n${picked.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
