// The extra tools of a whole-design turn: replace (bulk, dry run first), browse (Puppeteer: look at many frames, run
// a check in the page), run (the sandbox). Temp project, fake shots, fake sandbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDesignTools, DESIGN_TOOL_NAMES } from "./agent-tools-design.mjs";

function fixture(over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adt-"));
  const v = path.join(root, "versions", "ban-1");
  const b = path.join(v, "boards", "screens");
  fs.mkdirSync(b, { recursive: true });
  fs.mkdirSync(path.join(v, "system"), { recursive: true });
  fs.writeFileSync(path.join(v, "version.json"), "{}");
  fs.writeFileSync(path.join(b, "a.tsx"), 'x("p-3 gap-2"); y("p-3");\n');
  fs.writeFileSync(path.join(b, "a.meta.json"), JSON.stringify({ title: "A", scenarios: [{ id: "one", title: "One" }, { id: "two", title: "Two" }] }));
  fs.writeFileSync(path.join(b, "b.tsx"), 'z("p-3");\n');
  fs.writeFileSync(path.join(b, "b.meta.json"), JSON.stringify({ title: "B", scenarios: [{ id: "only", title: "Only" }] }));
  fs.writeFileSync(path.join(v, "system", "t.css"), "--a: 3px;\n");
  const inspected = [], swept = [];
  const shots = {
    inspect: async (a) => { inspected.push(a); return { png: a.shot === false ? null : Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]), height: 800, errors: a.entry === "screens/b" ? ["pageerror: boom"] : [], boardError: false, value: a.evalJs ? { n: 3 } : undefined }; },
    // One page load per screen: every scenario of it, in order (lib/shots.mjs).
    inspectScenarios: async (a) => { swept.push(a); return Promise.all(a.scenarios.map((scenario) => shots.inspect({ ...a, scenario, shot: false }))); },
  };
  const ran = [];
  const sandbox = { backend: "process", run: async (a) => { ran.push(a); return { code: 0, stdout: "hello\n", stderr: "", applied: ["boards/screens/a.tsx"], deleted: [], rejected: [{ rel: "boards/x.sh", reason: "not an editable file type" }], conflicts: [] }; } };
  const tools = createDesignTools({ root, ctx: { version: "ban-1", threadId: "t_1", entry: null }, shots, sandbox, lang: "en", ...over });
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  return { root, v, by, tools, inspected, swept, ran, read: (rel) => fs.readFileSync(path.join(v, rel), "utf8") };
}
const textOf = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

test("the design tool set: replace, browse and run; run only exists when there is a sandbox", () => {
  const f = fixture();
  assert.deepEqual(f.tools.map((t) => t.name), ["replace", "browse", "run"]);
  assert.deepEqual(DESIGN_TOOL_NAMES, ["replace", "browse", "run"]);
  for (const t of f.tools) assert.ok(t.description.length > 40 && t.shape, t.name);
  assert.deepEqual(fixture({ sandbox: null }).tools.map((t) => t.name), ["replace", "browse"]);
});

test("replace: a dry run (the default) reports the matches per file and changes nothing", async () => {
  const f = fixture();
  const r = await f.by.replace.handler({ pattern: "p-3", replacement: "p-2" });
  assert.ok(!r.isError);
  const t = textOf(r);
  assert.match(t, /boards\/screens\/a\.tsx — 2/);
  assert.match(t, /boards\/screens\/b\.tsx — 1/);
  assert.match(t, /3 matches in 2 files/);
  assert.match(t, /dry_run/i);
  assert.match(f.read("boards/screens/a.tsx"), /p-3/);
});

test("replace: dry_run false writes the files; paths narrows it; regex with groups works", async () => {
  const f = fixture();
  const r = await f.by.replace.handler({ pattern: "\\bp-(\\d)", replacement: "px-$1", regex: true, paths: "boards/screens/a.*", dry_run: false });
  assert.ok(!r.isError, textOf(r));
  assert.equal(f.read("boards/screens/a.tsx"), 'x("px-3 gap-2"); y("px-3");\n');
  assert.equal(f.read("boards/screens/b.tsx"), 'z("p-3");\n', "outside paths → untouched");
  assert.match(textOf(r), /2 files? ?|1 file/i);
});

test("replace: never writes where write may not — other types, version.json, CSS that runs code — and says so", async () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.v, "boards", "screens", "c.css"), "a { b: c }");
  const bad = await f.by.replace.handler({ pattern: "a { b: c }", replacement: '@plugin "./x.js";', paths: "boards/screens/c.css", dry_run: false });
  assert.equal(bad.isError, true);
  assert.match(textOf(bad), /plugin/i);
  assert.equal(f.read("boards/screens/c.css"), "a { b: c }");
  const out = await f.by.replace.handler({ pattern: '"id"', replacement: '"x"', paths: "version.json", dry_run: false });
  assert.match(textOf(out), /no editable file/i);
  assert.equal(fs.readFileSync(path.join(f.v, "version.json"), "utf8"), "{}");
});

test("replace: an invalid regex or an empty pattern is an error the model can read", async () => {
  const f = fixture();
  const r = await f.by.replace.handler({ pattern: "(", replacement: "x", regex: true });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /regular expression|invalid|unterminated/i);
});

test("browse: looks at the frames asked for — a picture each, height, errors, and the result of a check run in the page", async () => {
  const f = fixture();
  const r = await f.by.browse.handler({ frames: [{ entry: "screens/a", scenario: "one" }, { entry: "screens/b", scenario: "only", viewport: "mobile" }], eval: "document.querySelectorAll('button').length" });
  const t = textOf(r);
  assert.equal(r.content.filter((c) => c.type === "image").length, 2);
  assert.match(t, /screens\/a.*one.*800/s);
  assert.match(t, /boom/);
  assert.match(t, /"n":\s*3/);
  assert.equal(f.inspected[1].viewport, "mobile");
  assert.equal(f.inspected[0].version, "ban-1");
  assert.equal(f.inspected[0].evalJs, "document.querySelectorAll('button').length");
});

test("browse: all=true goes over every scenario of every screen, with no pictures by default, and a summary of what is broken", async () => {
  const f = fixture();
  const r = await f.by.browse.handler({ all: true });
  assert.equal(f.inspected.length, 3);
  // Screen by screen: a's two scenarios in one page load, b's one.
  assert.deepEqual(f.swept.map((s) => [s.entry, s.scenarios]), [["screens/a", ["one", "two"]], ["screens/b", ["only"]]]);
  assert.equal(r.content.filter((c) => c.type === "image").length, 0);
  const t = textOf(r);
  assert.match(t, /3 frames/);
  assert.match(t, /1 (with|had) (an )?errors?|1 broken|errors: 1/i);
  assert.match(t, /screens\/b.*boom/s);
});

test("browse: an unknown screen is an error, a frame cap keeps it from running for ever", async () => {
  const f = fixture();
  const bad = await f.by.browse.handler({ frames: [{ entry: "screens/nope" }] });
  assert.equal(bad.isError, true);
  const many = await f.by.browse.handler({ frames: Array.from({ length: 41 }, () => ({ entry: "screens/a" })) }).catch((e) => ({ isError: true, thrown: String(e) }));
  assert.equal(many.isError, true);
});

test("run: hands the command to the sandbox and reports output, files landed, files refused", async () => {
  const f = fixture();
  const r = await f.by.run.handler({ command: "echo hello", timeout_s: 20 });
  assert.equal(f.ran[0].command, "echo hello");
  assert.equal(f.ran[0].timeoutMs, 20_000);
  const t = textOf(r);
  assert.match(t, /hello/);
  assert.match(t, /boards\/screens\/a\.tsx/);
  assert.match(t, /boards\/x\.sh.*not an editable/);
  assert.ok(!r.isError);
});

test("run: a failing command (exit code ≠ 0) is an error result, a timeout says so", async () => {
  const f = fixture({ sandbox: { backend: "process", run: async () => ({ code: 2, stdout: "", stderr: "boom\n", applied: [], deleted: [], rejected: [], conflicts: [] }) } });
  const r = await f.by.run.handler({ command: "false" });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /exit code 2|2/);
  const g = fixture({ sandbox: { backend: "process", run: async () => ({ code: null, timedOut: true, stdout: "", stderr: "", applied: [], deleted: [], rejected: [], conflicts: [] }) } });
  const t = await g.by.run.handler({ command: "sleep 99" });
  assert.equal(t.isError, true);
  assert.match(textOf(t), /time/i);
});
