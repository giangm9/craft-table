// Pure checks of tests/spec-markdown.e2e.mjs (tests/lib/spec-check.mjs): what a spec page must show, worked out from
// its markdown, and what is wrong with what the browser saw. A page that shows no spec, or diagrams left as code,
// must be reported — not only markdown symbols left in whatever text there is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedSpec, leftoverSymbols, specProblems } from "./lib/spec-check.mjs";

const MD = [
  "# Task list — Behavior",
  "",
  "Intro text.",
  "",
  "## Rules",
  "",
  "**R1.** A rule.",
  "",
  "```mermaid",
  "flowchart LR",
  "  A --> B",
  "```",
  "",
  "## Flows",
  "",
  "### Adding",
  "",
  "~~~mermaid",
  "flowchart LR",
  "  C --> D",
  "~~~",
  "",
  "```ts",
  "// ```mermaid inside another fence is not a diagram",
  "```",
  "",
  "### Ticking",
  "",
  "Plain text.",
].join("\n");

test("expectedSpec: the sections /spec?p=all shows (ids and titles of the spec's pages) and the diagrams each draws", () => {
  const e = expectedSpec(MD);
  assert.deepEqual(e.pages.map((p) => [p.id, p.title, p.diagrams]), [
    ["overview", "Overview", 0],
    ["rules", "Rules", 1],
    ["flows/adding", "Adding", 1],
    ["flows/ticking", "Ticking", 0],
  ]);
  assert.equal(e.diagrams, 2);
  assert.deepEqual(expectedSpec(""), { pages: [], diagrams: 0 });
});

test("expectedSpec: the intro page is titled in the viewer's language (lang), its id stays the same", () => {
  assert.deepEqual(expectedSpec(MD, { lang: "vi" }).pages[0], { id: "overview", title: "Tổng quan", diagrams: 0 });
  assert.deepEqual(expectedSpec(MD, { lang: "en" }).pages[0], { id: "overview", title: "Overview", diagrams: 0 });
});

const seenOk = () => ({
  pages: [
    { id: "overview", title: "Overview", figures: 0, drawn: 0 },
    { id: "rules", title: "Rules", figures: 1, drawn: 1 },
    { id: "flows/adding", title: "Adding", figures: 1, drawn: 1 },
    { id: "flows/ticking", title: "Ticking", figures: 0, drawn: 0 },
  ],
  text: "Overview\nIntro text.\nRules\nR1. A rule.\nAdding\nTicking\nPlain text.",
});

test("specProblems: a page that shows every section with its heading and every diagram drawn has no problem", () => {
  assert.deepEqual(specProblems(expectedSpec(MD), seenOk()), []);
});

test("specProblems: a page that shows no spec at all (only a 'no content' note) is reported", () => {
  const problems = specProblems(expectedSpec(MD), { pages: [], text: "Spec\nTask list\nThis tab has no content yet." });
  assert.ok(problems.length >= 1);
  assert.match(problems.join("\n"), /no spec section shown/);
});

test("specProblems: a missing section, or a section under the wrong heading, is reported", () => {
  const seen = seenOk();
  seen.pages.splice(3, 1);
  seen.pages[1].title = "Something else";
  const p = specProblems(expectedSpec(MD), seen).join("\n");
  assert.match(p, /flows\/ticking.*not shown/);
  assert.match(p, /rules.*"Something else".*"Rules"/);
});

test("specProblems: diagrams left as code (no figure) or never drawn (figure without svg) are reported", () => {
  const asCode = seenOk();
  asCode.pages[1].figures = 0; asCode.pages[1].drawn = 0;
  assert.match(specProblems(expectedSpec(MD), asCode).join("\n"), /rules: 0 of 1 diagram drawn/);
  const undrawn = seenOk();
  undrawn.pages[2].drawn = 0;
  assert.match(specProblems(expectedSpec(MD), undrawn).join("\n"), /flows\/adding: 0 of 1 diagram drawn/);
});

test("specProblems: markdown symbols left in the rendered text are reported with the text around them", () => {
  const seen = seenOk();
  seen.text += "\nThis is **bold** and [a link](http://x)";
  const p = specProblems(expectedSpec(MD), seen).join("\n");
  assert.match(p, /\*\*: …/);
  assert.match(p, /\]\(: …/);
});

test("leftoverSymbols: **, headings, table rules, fences and links left as text; clean text has none", () => {
  assert.deepEqual(leftoverSymbols("A clean page.\nWith two lines."), []);
  const found = leftoverSymbols("x **y** z\n## Head\n| a |\n|---|\n```\n[t](u)").map((s) => s.split(":")[0]);
  assert.deepEqual(found, ["**", "##", "|---", "```", "]("]);
});
