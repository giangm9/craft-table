// `craft-table init`: the starter project must be accepted by the tool's own code (project, versions, entries, meta,
// lint, typecheck) and the studio must boot on it. Also covers the CLI dispatch (bin/craft-table.mjs).
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { initProject, runInit, parseInitArgs } from "./init.mjs";
import { loadProject } from "./project.mjs";
import { readIndex, readVersion, listVersions, updateVersion, setLive, createVersion, boardsDir, VERSION_STATUSES } from "./versions.mjs";
import { entryIdFromPath } from "./entries.mjs";
import { readMeta } from "./meta-io.mjs";
import { lint, typecheck } from "./checks.mjs";
import { cssDangers } from "./css-guard.mjs";
import { specPages } from "./spec-core.mjs";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const BIN = path.join(REPO, "bin", "craft-table.mjs");
// Every temp folder of this run lives under one root (checked empty by the last test, removed at the end).
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ct-init-"));
const tmp = () => fs.mkdtempSync(path.join(ROOT, "t-"));
const rmTree = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 });
// After each test: what it made (symlinks into the repo are unlinked, not followed).
afterEach(() => { for (const n of fs.readdirSync(ROOT)) rmTree(path.join(ROOT, n)); });
after(() => rmTree(ROOT));
const capture = () => {
  const lines = { out: [], err: [] };
  return { lines, io: { out: (s) => lines.out.push(String(s)), err: (s) => lines.err.push(String(s)) } };
};

/** What `npm i -D craft-table` leaves behind: package.json + craft-table and its dependencies hoisted in node_modules. */
function install(dir) {
  const nm = path.join(dir, "node_modules");
  fs.mkdirSync(nm, { recursive: true });
  for (const name of fs.readdirSync(path.join(REPO, "node_modules"))) {
    if (name.startsWith(".") && name !== ".bin") continue; // caches (.vite) stay private to each project
    fs.symlinkSync(path.join(REPO, "node_modules", name), path.join(nm, name));
  }
  fs.symlinkSync(REPO, path.join(nm, "craft-table"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "starter-test", private: true, devDependencies: { "craft-table": "*" } }));
}

/** Boards of a version, found the way the studio server lists them (skip _ and . folders, ids from paths). */
function boards(dir, v) {
  const root = boardsDir(dir, v), out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith("_") && !e.name.startsWith(".")) walk(abs); continue; }
      const id = entryIdFromPath(path.relative(root, abs).split(path.sep).join("/"));
      if (id) out.push({ id, abs, meta: readMeta(abs) });
    }
  };
  walk(root);
  return out;
}

function allFiles(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

// git without the caller's repository (GIT_DIR…) or user/system config (a global excludes file would skew the answers).
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (dir, ...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8", env: GIT_ENV });
const HAS_GIT = git(os.tmpdir(), "--version").status === 0;
/** Does git ignore `rel` in the repository at `dir`? The file is created first, as a user would. */
function gitIgnores(dir, rel) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, "");
  const r = git(dir, "check-ignore", "-q", rel);
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  return r.status === 0;
}

test("parseInitArgs: folder, --name, --lang (en|vi); anything else is a usage error", () => {
  assert.deepEqual(parseInitArgs([]), { folder: null, name: null, language: "en", help: false });
  assert.deepEqual(parseInitArgs(["acme", "--name", "Acme App", "--lang", "vi"]), { folder: "acme", name: "Acme App", language: "vi", help: false });
  assert.deepEqual(parseInitArgs(["--lang=en", "--name=X"]), { folder: null, name: "X", language: "en", help: false });
  assert.equal(parseInitArgs(["--help"]).help, true);
  assert.throws(() => parseInitArgs(["--lang", "fr"]), /--lang.*en.*vi/);
  assert.throws(() => parseInitArgs(["a", "b"]), /one folder/);
  assert.throws(() => parseInitArgs(["--colour", "red"]), /colour/);
  assert.throws(() => parseInitArgs(["--name", "  "]), /--name/);
});

test("initProject: a project the tool accepts — config, versions, one live version", () => {
  const dir = path.join(tmp(), "acme-design");
  const now = new Date("2026-10-24T08:00:00.000Z");
  initProject(dir, { now });
  const p = loadProject({ cwd: dir, env: {} });
  assert.equal(p.dir, dir);
  assert.deepEqual({ name: p.config.name, description: p.config.description, language: p.config.language }, { name: "acme-design", description: "", language: "en" });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "craft-table.json"), "utf8")), { name: "acme-design", description: "", language: "en" });
  assert.deepEqual(readIndex(dir), { live: "main", order: ["main"] });
  const v = readVersion(dir, "main");
  assert.deepEqual(Object.keys(v), ["id", "title", "status", "from", "createdAt", "createdBy", "note"]);
  assert.deepEqual({ ...v, status: undefined }, { id: "main", title: "Main", status: undefined, from: null, createdAt: now.toISOString(), createdBy: "craft-table init", note: "" });
  assert.ok(VERSION_STATUSES.includes(v.status));
  assert.deepEqual(listVersions(dir).map((x) => [x.id, x.live]), [["main", true]]);
  // The status is the one that means "live": making main live again changes nothing; the validator accepts it.
  const before = fs.readFileSync(path.join(dir, "versions", "main", "version.json"), "utf8");
  setLive(dir, "main");
  assert.equal(fs.readFileSync(path.join(dir, "versions", "main", "version.json"), "utf8"), before);
  assert.doesNotThrow(() => updateVersion(dir, "main", { status: v.status }));
  // No project rules folder; no placeholder left anywhere.
  assert.ok(!fs.existsSync(path.join(dir, "rules")));
  for (const f of allFiles(dir)) assert.ok(!fs.readFileSync(f, "utf8").includes("{{"), `placeholder left in ${f}`);
});

test("initProject: .gitignore keeps local data and credentials out of git (threads stay in git)", () => {
  const dir = tmp();
  initProject(dir, {});
  const lines = fs.readFileSync(path.join(dir, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
  // The studio's working folders sit at the project root: anchored, so a folder of the same name deeper down is kept.
  for (const l of ["/data/", "node_modules/", ".env", "/.chat-shots/"]) assert.ok(lines.includes(l), `.gitignore lacks ${l}`);
  assert.ok(!lines.some((l) => l.startsWith("threads")), "threads/ are design discussions — keep them in git");
  // An existing .gitignore is kept; only the missing lines are added.
  const d2 = tmp();
  fs.writeFileSync(path.join(d2, ".gitignore"), "node_modules/\n*.log\n");
  initProject(d2, {});
  const g = fs.readFileSync(path.join(d2, ".gitignore"), "utf8");
  assert.ok(g.startsWith("node_modules/\n*.log\n"), g);
  assert.equal(g.split("\n").filter((l) => l.trim() === "node_modules/").length, 1, g);
  for (const l of ["/data/", ".env", "/.chat-shots/"]) assert.ok(g.split("\n").includes(l), `${l} missing:\n${g}`);
  // A line the user already has, written with or without the slashes, counts as present.
  const d3 = tmp();
  fs.writeFileSync(path.join(d3, ".gitignore"), "data/\n.chat-shots\n");
  initProject(d3, {});
  assert.equal(fs.readFileSync(path.join(d3, ".gitignore"), "utf8"), "data/\n.chat-shots\n# craft-table\nnode_modules/\n.env\n");
});

test("initProject: git ignores only the project's own data/ and .chat-shots/ — a board folder or an app's src/data/ stays in git", { skip: !HAS_GIT && "git not installed" }, () => {
  const dir = tmp();
  initProject(dir, {});
  assert.equal(git(dir, "init", "-q").status, 0);
  for (const f of ["data/studio.sqlite", "data/uploads/a.png", ".chat-shots/1.png", ".env", "node_modules/x/index.js"]) assert.ok(gitIgnores(dir, f), `${f} should be ignored`);
  for (const f of ["versions/main/boards/screens/data/import.tsx", "versions/main/boards/screens/welcome.tsx", "threads/t_1.json"]) assert.ok(!gitIgnores(dir, f), `${f} should stay in git`);
  // init at the root of an existing app repository: its .gitignore gets the lines, its src/data/ is not swallowed.
  const app = tmp();
  assert.equal(git(app, "init", "-q").status, 0);
  fs.writeFileSync(path.join(app, ".gitignore"), "node_modules\n");
  initProject(app, {});
  assert.ok(!gitIgnores(app, "src/data/prices.ts"), "the app's src/data/ stays in git");
  assert.ok(gitIgnores(app, "data/studio.sqlite"));
  assert.ok(gitIgnores(app, ".chat-shots/1.png"));
});

test("initProject: welcome board found like the studio finds boards; meta, 2 scenarios, both spec tabs, shared rule numbers", () => {
  const dir = tmp();
  initProject(dir, {});
  const list = boards(dir, "main");
  assert.deepEqual(list.map((b) => b.id), ["screens/welcome"]);
  const [w] = list;
  assert.ok(w.meta && typeof w.meta.title === "string" && w.meta.title.trim(), "meta readable, has a title");
  assert.ok(typeof w.meta.desc === "string" && w.meta.desc.trim());
  assert.equal(w.meta.scenarios.length, 2);
  const src = fs.readFileSync(w.abs, "utf8");
  assert.match(src, /export default function/);
  assert.match(src, /scenario/);
  for (const s of w.meta.scenarios) {
    assert.ok(s.id && s.title && s.desc, JSON.stringify(s));
    assert.ok(src.includes(`"${s.id}"`), `the board draws scenario ${s.id}`);
  }
  for (const vp of w.meta.viewports ?? []) assert.ok(["desktop", "mobile"].includes(vp));
  const rules = (kind) => specPages(fs.readFileSync(path.join(boardsDir(dir, "main"), `screens/welcome.${kind}.md`), "utf8")).flatMap((p) => p.rules);
  assert.ok(rules("behavior").length > 0);
  assert.deepEqual(rules("tech"), rules("behavior"), "both tabs share the rule numbers R1…Rn");
});

test("initProject: plain-language lint passes; tokens.css passes the CSS guard; design system exports Button and Card", () => {
  const dir = tmp();
  initProject(dir, {});
  assert.deepEqual(lint(dir, "main", ["screens/welcome"], { plainLanguage: true }), { ok: true, issues: [] });
  const sys = path.join(dir, "versions", "main", "system");
  const css = fs.readFileSync(path.join(sys, "tokens.css"), "utf8");
  assert.deepEqual(cssDangers(css), []);
  assert.match(css, /@import "tailwindcss";/);
  assert.match(css, /@theme static/);
  for (const t of ["--color-ink-50", "--color-ink-900", "--color-accent-50", "--color-accent-900", "--color-surface:", "--color-surface-2", "--font-sans"]) assert.ok(css.includes(t), t);
  const index = fs.readFileSync(path.join(sys, "components", "index.ts"), "utf8");
  for (const n of ["Button", "Card", "cn"]) assert.match(index, new RegExp(`\\b${n}\\b`));
  const ts = JSON.parse(fs.readFileSync(path.join(dir, "versions", "main", "tsconfig.json"), "utf8"));
  assert.equal(ts.extends, "craft-table/tsconfig.base.json");
  assert.deepEqual(ts.compilerOptions.paths, { "@ds": ["./system/components/index.ts"], "@ds/*": ["./system/components/*"] });
  assert.deepEqual([...ts.include].sort(), ["boards", "system"]);
});

test("initProject: name and language go into the project; quotes in the name stay valid JSON and TypeScript", () => {
  const dir = tmp();
  initProject(dir, { name: 'Acme "Pro" \\ Studio', language: "vi" });
  const p = loadProject({ cwd: dir, env: {} });
  assert.equal(p.config.name, 'Acme "Pro" \\ Studio');
  assert.equal(p.config.language, "vi");
  const board = fs.readFileSync(path.join(boardsDir(dir, "main"), "screens", "welcome.tsx"), "utf8");
  assert.ok(board.includes(JSON.stringify('Acme "Pro" \\ Studio')), board.slice(0, 600));
});

test("initProject: refuses a folder that already is a project, or already has versions/ — nothing is touched", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "craft-table.json"), '{"name":"Old"}');
  assert.throws(() => initProject(dir, {}), /craft-table\.json already exists/);
  assert.deepEqual(fs.readdirSync(dir), ["craft-table.json"]);
  const d2 = tmp();
  fs.mkdirSync(path.join(d2, "versions"));
  assert.throws(() => initProject(d2, {}), /versions/);
  assert.deepEqual(fs.readdirSync(d2), ["versions"]);
});

test("runInit: default folder is the working directory; prints next steps (install, start, open, login)", async () => {
  const dir = path.join(tmp(), "shop");
  fs.mkdirSync(dir);
  const { lines, io } = capture();
  assert.equal(await runInit([], { cwd: dir, env: {}, ...io }), 0);
  assert.equal(loadProject({ cwd: dir, env: {} }).config.name, "shop");
  const out = lines.out.join("\n");
  for (const s of ["npm i -D craft-table", "npx craft-table start", "http://localhost:5180", "npx craft-table login"]) assert.ok(out.includes(s), `${s} in:\n${out}`);
  assert.ok(!out.includes("cd "), "already in the folder");
  assert.ok(out.includes("npm init -y"), "no package.json yet → create one first, so the install lands in this folder");
});

test("runInit: into a sub-folder → `cd` step; craft-table already a dependency → no install step", async () => {
  const parent = tmp();
  const { lines, io } = capture();
  assert.equal(await runInit(["my design", "--name", "Shop"], { cwd: parent, env: {}, ...io }), 0);
  const out = lines.out.join("\n");
  assert.ok(out.includes('cd "my design"'), out);
  assert.equal(loadProject({ cwd: path.join(parent, "my design"), env: {} }).config.name, "Shop");
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", devDependencies: { "craft-table": "^0.1.0" } }));
  const c2 = capture();
  assert.equal(await runInit([], { cwd: dir, env: {}, ...c2.io }), 0);
  const out2 = c2.lines.out.join("\n");
  assert.ok(!out2.includes("npm i -D craft-table") && !out2.includes("npm init"), out2);
  assert.ok(out2.includes("npx craft-table start"));
});

test("runInit: existing project → exit 1 with a clear message; bad option → exit 1 with usage", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "craft-table.json"), '{"name":"Old"}');
  const { lines, io } = capture();
  assert.equal(await runInit([], { cwd: dir, env: {}, ...io }), 1);
  assert.match(lines.err.join("\n"), /craft-table\.json already exists/);
  const c2 = capture();
  assert.equal(await runInit(["--lang", "fr"], { cwd: tmp(), env: {}, ...c2.io }), 1);
  assert.match(c2.lines.err.join("\n"), /Usage: craft-table init/);
});

test("the created version typechecks with the installed tool (tsconfig extends craft-table/tsconfig.base.json), also after copying it", { timeout: 180_000 }, async () => {
  const dir = tmp();
  initProject(dir, { name: 'Acme "Pro"' });
  install(dir);
  const r = await typecheck(dir, "main", { studio: false });
  assert.ok(r.ok, r.out);
  const copy = createVersion(dir, { from: "main", title: "Next", by: "test" });
  assert.equal(fs.readFileSync(path.join(dir, "versions", copy.id, "tsconfig.json"), "utf8"), fs.readFileSync(path.join(dir, "versions", "main", "tsconfig.json"), "utf8"));
});

const run = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", timeout: 60_000, ...opts });

test("CLI: help → usage on stdout, exit 0; unknown command → usage on stderr, exit 1", () => {
  for (const h of [[], ["help"], ["--help"]]) {
    const r = run(h);
    assert.equal(r.status, 0, r.stderr);
    for (const c of ["start", "init", "login"]) assert.match(r.stdout, new RegExp(`craft-table ${c}`));
  }
  const bad = run(["bogus"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown command: bogus/);
  assert.match(bad.stderr, /craft-table init/);
  assert.equal(bad.stdout, "");
});

test("CLI: init creates the project; a second init refuses with exit 1; start outside a project → exit 1 with a hint", () => {
  const parent = tmp();
  const r = run(["init", "acme", "--name", "Acme"], { cwd: parent });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(loadProject({ cwd: path.join(parent, "acme"), env: {} }).config.name, "Acme");
  assert.match(r.stdout, /npx craft-table start/);
  const again = run(["init"], { cwd: path.join(parent, "acme") });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already exists/);
  const empty = tmp();
  const s = run(["start"], { cwd: empty, env: { ...process.env, CRAFT_PROJECT: "" } });
  assert.equal(s.status, 1);
  assert.match(s.stderr, /craft-table init/);
  assert.doesNotMatch(s.stderr, /\n\s+at /, "a message, not a stack trace");
});

test("boot: `craft-table start` serves the new project — project info, the welcome entry, its frame", { timeout: 180_000 }, async () => {
  const dir = tmp();
  initProject(dir, { name: "Boot Test" });
  install(dir);
  const port = 5192;
  const child = spawn(process.execPath, [BIN, "start"], { cwd: dir, env: { ...process.env, CRAFT_PROJECT: dir, STUDIO_PORT: String(port), STUDIO_ENV_FILE: path.join(dir, ".env") }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (c) => { log += c; });
  child.stderr.on("data", (c) => { log += c; });
  const exited = new Promise((r) => child.once("exit", (code) => r(code)));
  const base = `http://127.0.0.1:${port}`;
  try {
    let project = null;
    for (const t0 = Date.now(); Date.now() - t0 < 90_000;) {
      if (child.exitCode !== null) break;
      try { const res = await fetch(`${base}/__api/project`); if (res.ok) { project = await res.json(); break; } } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(project, `studio did not come up:\n${log.slice(-3000)}`);
    assert.equal(project.name, "Boot Test");
    assert.equal(project.language, "en");
    const entries = await (await fetch(`${base}/__api/entries`)).json();
    assert.equal(entries.version, "main");
    assert.deepEqual(entries.entries.map((e) => e.id), ["screens/welcome"]);
    assert.ok(entries.entries[0].meta.scenarios.length === 2 && entries.entries[0].meta.section !== "Lỗi", JSON.stringify(entries.entries[0].meta));
    const frame = await fetch(`${base}/frame?e=screens/welcome`);
    assert.equal(frame.status, 200);
    assert.match(frame.headers.get("content-type") ?? "", /text\/html/);
    const html = await frame.text();
    assert.match(html, /<div id="root">/);
    assert.match(html, /frame-entry\.tsx/);
    // What the frame then loads: the board compiles (React + "@ds" of this version) and so do the tokens (Tailwind).
    const board = await fetch(`${base}/versions/main/boards/screens/welcome.tsx`);
    assert.equal(board.status, 200, await board.clone().text());
    assert.match(await board.text(), /system\/components\/index\.ts/);
    const css = await fetch(`${base}/versions/main/system/tokens.css`);
    assert.equal(css.status, 200, await css.clone().text());
    assert.match(await css.text(), /--color-accent-600/);
  } finally {
    child.kill("SIGTERM");
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r("timeout"), 15_000))]);
    if (code === "timeout") { child.kill("SIGKILL"); await exited; }
  }
});

// Keep last: by now every earlier test has removed its temp folders (the boot test's project alone holds ~30 MB of
// Vite's dependency cache).
test("temp folders: no test leaves one behind", () => {
  assert.deepEqual(fs.readdirSync(ROOT), []);
});
