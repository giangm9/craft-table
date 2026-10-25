// The example project shipped with craft-table (example/): a neutral team to-do app that new users open first and
// the e2e tests run against. Checks it the way the studio reads it — config, versions, boards and their meta, the two
// spec tabs, the design system — and that its boards typecheck. Run: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProject } from "../studio/lib/project.mjs";
import { VERSION_STATUSES, boardsDir, listVersions, readIndex, systemDir, versionDir } from "../studio/lib/versions.mjs";
import { entryIdFromPath } from "../studio/lib/entries.mjs";
import { readMeta } from "../studio/lib/meta-io.mjs";
import { specPages } from "../studio/lib/spec-core.mjs";
import { behaviorIssues, humanIssues } from "../studio/lib/spec-lint.mjs";
import { unwrapMarkdown } from "../studio/lib/md-unwrap.mjs";
import { cssDangers } from "../studio/lib/css-guard.mjs";
import { listThreads } from "../studio/lib/threads.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const EXAMPLE = path.join(REPO, "example");
const V = "main";
/** The example's language: the plain-language rule uses its vocabulary. */
const LANG = loadProject({ cwd: EXAMPLE, env: {} }).config.language;
const SCREENS = {
  "screens/tasks/list": ["few-tasks", "empty", "many-tasks"],
  "screens/tasks/detail": ["open-task", "done-task"],
  "screens/settings": ["default", "reminders-off"],
};
const BOARDS = [...Object.keys(SCREENS), "system/colors"].sort();
const SCENARIO_ID = /^[a-z0-9][a-z0-9-]{0,59}$/; // same rule as studio/lib/thread-core.mjs
// A rule is DEFINED where its number is bold at the start of a line or list item (studio/lib/spec-core.mjs).
const RULE_DEF = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\*\*(R\d+)\.?\*\*/gm;
const RULE_REF = /\*\*(R\d+)\.?\*\*/g;

const read = (...p) => fs.readFileSync(path.join(...p), "utf8");
const json = (...p) => JSON.parse(read(...p));
const boards = () => boardsDir(EXAMPLE, V);
const metaOf = (id) => readMeta(path.join(boards(), `${id}.tsx`));

function walk(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, d.name);
    if (d.isDirectory()) walk(abs, out); else out.push(abs);
  }
  return out;
}

test("craft-table.json: Acme Tasks, English, no source repo, plain-language lint off", () => {
  const { dir, config } = loadProject({ cwd: EXAMPLE, env: {} });
  assert.equal(dir, EXAMPLE);
  assert.deepEqual(config, {
    name: "Acme Tasks",
    description: "a small team to-do app",
    language: "en",
    logo: null,
    source: null,
    lint: { plainLanguage: false },
    externalOrigins: [],
    desktop: { w: 1280, h: 800 }, // no "desktop" in the example → the default frame size
  });
});

test("versions: one live version, main, whose version.json has the studio's shape and a valid status", () => {
  assert.deepEqual(readIndex(EXAMPLE), { live: V, order: [V] });
  const [v, ...rest] = listVersions(EXAMPLE);
  assert.equal(rest.length, 0);
  const file = json(versionDir(EXAMPLE, V), "version.json");
  assert.deepEqual(Object.keys(file).sort(), ["createdAt", "createdBy", "from", "id", "note", "status", "title"]);
  assert.equal(v.id, V);
  assert.equal(v.live, true);
  assert.equal(v.from, null);
  assert.ok(VERSION_STATUSES.includes(v.status), `status "${v.status}" is not one of ${VERSION_STATUSES.join(", ")}`);
  assert.equal(file.status, "live", "the file itself stores the neutral code of the live version");
  assert.ok(v.title.trim() && v.note.trim() && v.createdBy.trim());
  assert.equal(new Date(v.createdAt).toISOString(), v.createdAt);
});

test("version tsconfig: extends the repo's base config, @ds points at this version's design system", () => {
  const dir = versionDir(EXAMPLE, V);
  const ts = json(dir, "tsconfig.json");
  assert.equal(ts.extends, "../../../tsconfig.base.json");
  assert.equal(path.resolve(dir, ts.extends), path.join(REPO, "tsconfig.base.json"));
  assert.deepEqual(ts.compilerOptions.paths, { "@ds": ["./system/components/index.ts"], "@ds/*": ["./system/components/*"] });
  assert.deepEqual(ts.include, ["system", "boards"]);
});

test("boards: three screens and the colors page, each with meta the studio can read", () => {
  const ids = walk(boards()).map((f) => entryIdFromPath(path.relative(boards(), f).split(path.sep).join("/"))).filter(Boolean).sort();
  assert.deepEqual(ids, BOARDS);
  for (const id of ids) {
    assert.ok(fs.existsSync(path.join(boards(), `${id}.meta.json`)), `${id}: meta lives in ${id}.meta.json`);
    const m = metaOf(id);
    assert.ok(m, `${id}: meta.json is readable`);
    for (const k of ["title", "section", "group", "desc"]) assert.ok(typeof m[k] === "string" && m[k].trim(), `${id}: ${k}`);
    assert.equal(typeof m.order, "number", `${id}: order`);
    assert.ok(Array.isArray(m.viewports) && m.viewports.length && m.viewports.every((x) => x === "desktop" || x === "mobile"), `${id}: viewports`);
    assert.equal(m.option, undefined, `${id}: not an option`);
  }
  assert.equal(metaOf("system/colors").section, "Design system");
  const first = ids.map((id) => ({ id, order: metaOf(id).order })).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0];
  assert.equal(first.id, "screens/tasks/list", "the task list opens first");
});

test("screen boards: scenarios with stable ids; titles, descriptions and scenarios in plain words", () => {
  for (const [id, scenarios] of Object.entries(SCREENS)) {
    const m = metaOf(id);
    assert.deepEqual(m.scenarios.map((s) => s.id), scenarios, `${id}: scenarios`);
    for (const s of m.scenarios) {
      assert.match(s.id, SCENARIO_ID);
      assert.ok(s.title?.trim() && s.desc?.trim(), `${id}~${s.id}: title + desc`);
    }
    const words = [m.title, m.desc, ...m.scenarios.flatMap((s) => [s.title, s.desc])];
    assert.deepEqual(words.flatMap((w) => humanIssues(w, { lang: LANG })), [], `${id}: meta reads as plain words`);
  }
});

test("screen boards: Behavior + Technical specs share rule numbers; behavior is plain words, one line per paragraph", () => {
  for (const [id, scenarios] of Object.entries(SCREENS)) {
    const title = metaOf(id).title;
    const beh = read(boards(), `${id}.behavior.md`);
    const tech = read(boards(), `${id}.tech.md`);
    assert.equal(beh.split("\n")[0], `# ${title} — Behavior`, `${id}: behavior heading`);
    assert.equal(tech.split("\n")[0], `# ${title} — Technical`, `${id}: technical heading`);
    assert.ok(specPages(beh).length >= 3 && specPages(tech).length >= 3, `${id}: both tabs have a table of contents`);
    const defined = [...beh.matchAll(RULE_DEF)].map((m) => m[1]);
    assert.ok(defined.length >= 3, `${id}: behavior defines rules`);
    assert.deepEqual(defined, defined.map((_, i) => `R${i + 1}`), `${id}: rules numbered R1…Rn in order`);
    const inTech = new Set([...tech.matchAll(RULE_REF)].map((m) => m[1]));
    assert.deepEqual([...inTech].sort(), [...defined].sort(), `${id}: the technical tab covers exactly the same rules`);
    assert.deepEqual(behaviorIssues(beh, { lang: LANG }), [], `${id}: behavior tab is plain words`);
    for (const [kind, md] of [["behavior", beh], ["tech", tech]]) {
      assert.equal(unwrapMarkdown(md), md, `${id}.${kind}.md: a paragraph or list item is hard-wrapped`);
      assert.ok(md.includes("```mermaid"), `${id}.${kind}.md: has a diagram`);
      assert.ok(!/```src\b/.test(md), `${id}.${kind}.md: no source embeds (the example has no source repo)`);
    }
    for (const s of scenarios) assert.ok(beh.includes(s) && tech.includes(s), `${id}: scenario ${s} appears in both tabs`);
  }
});

test("design system: tokens use the studio's names (ink, accent, surface) in light and dark; nothing the studio blocks", () => {
  const css = read(systemDir(EXAMPLE, V), "tokens.css");
  assert.deepEqual(cssDangers(css), []);
  assert.match(css, /@import "tailwindcss";/);
  const block = (src, head) => {
    const i = src.indexOf(head);
    assert.ok(i >= 0, `missing ${head}`);
    return src.slice(i, src.indexOf("}", i));
  };
  const names = (src) => new Set([...src.matchAll(/(--color-(?:ink|accent)-\d+|--color-surface(?:-2)?)\s*:/g)].map((m) => m[1]));
  const studio = names(block(read(REPO, "studio", "ui", "tokens.css"), "@theme static"));
  assert.ok(studio.size >= 21);
  const light = names(block(css, "@theme static"));
  const dark = names(block(css, ':root[data-theme="dark"]'));
  for (const n of studio) {
    assert.ok(light.has(n), `light theme defines ${n}`);
    assert.ok(dark.has(n), `dark theme defines ${n}`);
  }
});

test("design system: index exports cn and the five components, one typed file each", () => {
  const dir = path.join(systemDir(EXAMPLE, V), "components");
  const index = read(dir, "index.ts");
  for (const name of ["cn", "Button", "Card", "Badge", "Checkbox", "TextField"]) {
    assert.match(index, new RegExp(`export \\{[^}]*\\b${name}\\b[^}]*\\} from "\\./${name}"`), `index exports ${name}`);
    assert.ok(fs.existsSync(path.join(dir, `${name}.${name === "cn" ? "ts" : "tsx"}`)), `${name} file`);
  }
});

test("boards import only react, lucide-react, @ds and boards/_kit", () => {
  const kit = path.join(boards(), "_kit");
  for (const f of walk(boards()).filter((x) => /\.tsx?$/.test(x))) {
    for (const [, spec] of fs.readFileSync(f, "utf8").matchAll(/^\s*import\s[^"']*["']([^"']+)["']/gm)) {
      if (spec === "react" || spec === "lucide-react" || spec === "@ds" || spec.startsWith("@ds/")) continue;
      const target = path.resolve(path.dirname(f), spec);
      assert.ok(spec.startsWith(".") && target.startsWith(kit + path.sep), `${path.relative(EXAMPLE, f)} imports "${spec}"`);
    }
  }
});

test("threads: the example ships without conversations; a missing folder reads as empty", async () => {
  const gone = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "example-threads-")), "threads");
  assert.deepEqual(await listThreads(gone), []);
  const ignored = read(EXAMPLE, ".gitignore").split("\n").map((l) => l.trim());
  assert.ok(ignored.includes("data/"), "example/.gitignore keeps the studio's runtime data (history, uploads) out of git");
});

test("typecheck: boards and design system of the example compile", () => {
  const tsc = path.join(REPO, "node_modules", "typescript", "bin", "tsc");
  try {
    execFileSync(process.execPath, [tsc, "--noEmit", "-p", path.join("example", "versions", V, "tsconfig.json")], { cwd: REPO, encoding: "utf8", timeout: 240_000 });
  } catch (e) {
    assert.fail(`tsc failed:\n${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
});
