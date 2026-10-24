// Parts of tests/run-e2e.mjs: which test files run, the environment of the studio it starts, the summary, what a run
// left in the project, and stopping a child process that cleans up on SIGTERM.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { changes, pickTests, snapshot, stopChild, strays, studioEnv, summary, testEnv } from "./lib/runner.mjs";

test("pickTests: every *.e2e.mjs, sorted; words keep the files whose name contains one", () => {
  const names = ["spec-editor.e2e.mjs", "composer.e2e.mjs", "runner.test.mjs", "lib", "boards.e2e.mjs", "run-e2e.mjs", "notes.md"];
  assert.deepEqual(pickTests(names), { files: ["boards.e2e.mjs", "composer.e2e.mjs", "spec-editor.e2e.mjs"], unmatched: [] });
  assert.deepEqual(pickTests(names, ["spec", "compo"]), { files: ["composer.e2e.mjs", "spec-editor.e2e.mjs"], unmatched: [] });
  assert.deepEqual(pickTests(names, ["board", "nope"]), { files: ["boards.e2e.mjs"], unmatched: ["nope"] });
});

test("studioEnv: serves the given project on the given port, and can never reach Claude", () => {
  const env = studioEnv(
    { PATH: "/bin", HOME: "/home/me", ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", CLAUDE_CODE_OAUTH_TOKEN: "o", CRAFT_PROJECT: "/elsewhere", STUDIO_ENV_FILE: "/secret.env" },
    { project: "/repo/example", port: 5190, home: "/tmp/e2e-home" },
  );
  assert.equal(env.PATH, "/bin");
  assert.equal(env.CRAFT_PROJECT, "/repo/example");
  assert.equal(env.STUDIO_PORT, "5190");
  // A home without Claude credentials, no API keys, no project .env (which could carry keys): a test that slips
  // past noAgent makes Claude fail to log in instead of running for real.
  assert.equal(env.HOME, "/tmp/e2e-home");
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]) assert.equal(k in env, false, k);
  assert.equal(env.STUDIO_ENV_FILE, "/tmp/e2e-home/no.env");
});

test("testEnv: each test file gets the studio's address and the project folder (tests that edit files on disk)", () => {
  const env = testEnv({ PATH: "/bin", STUDIO: "http://elsewhere", CRAFT_PROJECT: "/other" }, { studio: "http://127.0.0.1:5190", project: "/repo/example" });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.STUDIO, "http://127.0.0.1:5190");
  assert.equal(env.CRAFT_PROJECT, "/repo/example");
});

test("summary: one line per test, totals; ok only when every test passed", () => {
  const pass = summary([{ name: "a.e2e.mjs", ok: true, ms: 1500 }, { name: "b.e2e.mjs", ok: true, ms: 250 }]);
  assert.equal(pass.ok, true);
  assert.match(pass.text, /✓ a\.e2e\.mjs\s+1\.5 s/);
  assert.match(pass.text, /2 passed, 0 failed/);
  const fail = summary([{ name: "a.e2e.mjs", ok: true, ms: 1000 }, { name: "b.e2e.mjs", ok: false, ms: 2000, why: "exit code 1" }]);
  assert.equal(fail.ok, false);
  assert.match(fail.text, /✗ b\.e2e\.mjs\s+2\.0 s\s+exit code 1/);
  assert.match(fail.text, /1 passed, 1 failed/);
  assert.equal(summary([]).ok, false, "running nothing is not a pass");
});

// ── Leftovers: what a test run (or an interrupted one) may leave in the shipped example project ──

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ct-runner-"));
  const put = (rel, text = "x") => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put("craft-table.json", "{}");
  put("versions/index.json", JSON.stringify({ live: "main", order: ["main"] }));
  put("versions/main/version.json", "{}");
  put("versions/main/boards/screens/tasks/list.tsx");
  put("versions/main/boards/screens/tasks/list.meta.json");
  put("data/history.sqlite", "db");
  return { dir, put, rm: (rel) => fs.rmSync(path.join(dir, rel), { recursive: true, force: true }) };
}

test("snapshot + changes: files added, changed or removed in the project between two snapshots; data/ is ignored", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const before = snapshot(f.dir);
  assert.deepEqual(changes(before, snapshot(f.dir)), []);
  f.put("versions/main/boards/screens/tasks/list~compact.tsx");
  f.put("threads/t_1234abcd.json", "{}");
  f.put("versions/index.json", JSON.stringify({ live: "main", order: ["e2e-x", "main"] }));
  f.put("versions/e2e-x/version.json", "{}");
  f.rm("versions/main/boards/screens/tasks/list.meta.json");
  f.put("data/history.sqlite", "changed db");
  assert.deepEqual(changes(before, snapshot(f.dir)), [
    "added threads/t_1234abcd.json",
    "added versions/e2e-x/version.json",
    "added versions/main/boards/screens/tasks/list~compact.tsx",
    "changed versions/index.json",
    "removed versions/main/boards/screens/tasks/list.meta.json",
  ]);
});

test("strays: what the shipped example never holds — other versions, options, threads; none in a clean project", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  assert.deepEqual(strays(f.dir), []);
  fs.mkdirSync(path.join(f.dir, "threads")); // an empty threads/ folder is fine (the studio makes it)
  assert.deepEqual(strays(f.dir), []);
  f.put("versions/main/boards/screens/tasks/list~compact.meta.json");
  f.put("threads/t_1234abcd.json", "{}");
  f.put("versions/index.json", JSON.stringify({ live: "main", order: ["e2e-x", "main"] }));
  f.put("versions/e2e-x/version.json", "{}");
  f.put("versions/e2e-x/boards/screens/tasks/list~other.tsx");
  assert.deepEqual(strays(f.dir), [
    "threads/t_1234abcd.json",
    "versions/e2e-x/",
    "versions/index.json lists e2e-x, main",
    "versions/main/boards/screens/tasks/list~compact.meta.json",
  ]);
});

test("stopChild: waits for a child that cleans up after SIGTERM; kills one that does not stop in time", async (t) => {
  const { spawn } = await import("node:child_process");
  const kids = [];
  t.after(() => { for (const k of kids) k.kill("SIGKILL"); }); // never leave a child behind, even when this test fails
  // Cleans up for 300 ms after SIGTERM, then says so and exits 0.
  const polite = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => setTimeout(() => { console.log('cleaned'); process.exit(0); }, 300)); console.log('up'); setInterval(() => {}, 1000);"], { stdio: ["ignore", "pipe", "inherit"] });
  kids.push(polite);
  let out = "";
  polite.stdout.on("data", (d) => { out += d; });
  await new Promise((r) => polite.stdout.once("data", r));
  const t0 = Date.now();
  await stopChild(polite, 5_000);
  assert.equal(polite.exitCode, 0);
  assert.match(out, /cleaned/);
  assert.ok(Date.now() - t0 >= 250, "waited for the clean-up");

  // Ignores SIGTERM: killed once the grace time is over.
  const stuck = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); console.log('up'); setInterval(() => {}, 1000);"], { stdio: ["ignore", "pipe", "inherit"] });
  kids.push(stuck);
  await new Promise((r) => stuck.stdout.once("data", r));
  await stopChild(stuck, 300);
  assert.equal(stuck.signalCode, "SIGKILL");

  // Already gone: returns at once.
  await stopChild(stuck, 300);
});
