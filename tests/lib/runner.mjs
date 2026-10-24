// Parts of tests/run-e2e.mjs (tested in tests/runner.test.mjs).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Test files to run among `names` (a folder listing): every *.e2e.mjs, sorted; `filters` keep names containing one. */
export function pickTests(names, filters = []) {
  const all = names.filter((n) => n.endsWith(".e2e.mjs")).sort();
  if (!filters.length) return { files: all, unmatched: [] };
  return {
    files: all.filter((n) => filters.some((f) => n.includes(f))),
    unmatched: filters.filter((f) => !all.some((n) => n.includes(f))),
  };
}

// Ways the Claude agent could log in. The studio started for the tests gets none of them.
const CREDENTIALS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];

/**
 * Environment of the studio the runner starts: serve `project` on `port`, with an empty `home` (no stored Claude
 * login), no API keys and no project .env — so a test that slips past noAgent cannot start a real Claude turn.
 */
export function studioEnv(env, { project, port, home }) {
  const out = { ...env };
  for (const k of CREDENTIALS) delete out[k];
  return { ...out, CRAFT_PROJECT: project, STUDIO_PORT: String(port), HOME: home, STUDIO_ENV_FILE: `${home}/no.env` };
}

/** Environment of one test file: the studio's address (STUDIO) and the project folder it serves (CRAFT_PROJECT). */
export function testEnv(env, { studio, project }) {
  return { ...env, STUDIO: studio, CRAFT_PROJECT: project };
}

const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

/** results: [{ name, ok, ms, why? }] → { ok, text }. Nothing run is not a pass. */
export function summary(results) {
  const w = Math.max(0, ...results.map((r) => r.name.length));
  const lines = results.map((r) => `${r.ok ? "✓" : "✗"} ${r.name.padEnd(w)}  ${secs(r.ms).padStart(7)}${r.ok ? "" : `  ${r.why ?? "failed"}`}`);
  const failed = results.filter((r) => !r.ok).length;
  lines.push(`${results.length - failed} passed, ${failed} failed`);
  return { ok: results.length > 0 && failed === 0, text: lines.join("\n") };
}

// ── What a run leaves in the project ──

const SKIP = new Set(["data", "node_modules", ".git"]); // runtime data (git-ignored), never part of the project

/** Every file of project folder `dir` (except data/) → Map(relative path → content hash). */
export function snapshot(dir) {
  const out = new Map();
  const walk = (rel) => {
    for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (!rel && SKIP.has(d.name)) continue;
      if (d.isDirectory()) walk(r);
      else if (d.isFile()) out.set(r, crypto.createHash("sha1").update(fs.readFileSync(path.join(dir, r))).digest("hex"));
    }
  };
  walk("");
  return out;
}

/** Two snapshots → ["added <path>", …, "changed <path>", …, "removed <path>", …], sorted. */
export function changes(before, after) {
  const out = [];
  for (const [p, h] of after) if (!before.has(p)) out.push(`added ${p}`); else if (before.get(p) !== h) out.push(`changed ${p}`);
  for (const p of before.keys()) if (!after.has(p)) out.push(`removed ${p}`);
  return out.sort();
}

/**
 * What the shipped example never holds but a test run can leave behind (an interrupted or killed one): version folders
 * other than the live one, a version list other than [live], options (`<id>~<slug>.*`) in the live version, thread
 * files. → sorted relative paths; empty for a clean project.
 */
export function strays(dir) {
  const out = [];
  const index = JSON.parse(fs.readFileSync(path.join(dir, "versions", "index.json"), "utf8"));
  const live = index.live;
  for (const d of fs.readdirSync(path.join(dir, "versions"), { withFileTypes: true })) if (d.isDirectory() && d.name !== live) out.push(`versions/${d.name}/`);
  if (!Array.isArray(index.order) || index.order.length !== 1 || index.order[0] !== live) out.push(`versions/index.json lists ${(index.order ?? []).join(", ")}`);
  const boards = path.join(dir, "versions", live, "boards");
  const walk = (rel) => {
    for (const d of fs.readdirSync(path.join(boards, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(r); else if (d.name.includes("~")) out.push(`versions/${live}/boards/${r}`);
    }
  };
  if (fs.existsSync(boards)) walk("");
  const threads = path.join(dir, "threads");
  if (fs.existsSync(threads)) for (const d of fs.readdirSync(threads, { withFileTypes: true })) if (d.isFile()) out.push(`threads/${d.name}`);
  return out.sort();
}

// ── Child processes ──

/**
 * Stop a child process that cleans up on SIGTERM (a test file: browser, threads, versions…; the studio: databases):
 * SIGTERM, wait up to `graceMs` for it to exit, then SIGKILL. Returns once it has exited.
 */
export async function stopChild(child, graceMs) {
  const done = () => child.exitCode !== null || child.signalCode !== null;
  if (done()) return;
  const gone = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  let timer;
  const late = await Promise.race([gone.then(() => false), new Promise((resolve) => { timer = setTimeout(() => resolve(true), graceMs); })]);
  clearTimeout(timer);
  if (late && !done()) { child.kill("SIGKILL"); await gone; }
}
