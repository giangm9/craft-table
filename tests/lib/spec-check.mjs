// Pure checks of tests/spec-markdown.e2e.mjs (tested in tests/spec-check.test.mjs). The expected page is worked out
// from the spec's markdown with the studio's own page split (studio/lib/spec-core.mjs specPages), so a page that shows
// no spec, drops a section, or leaves diagrams as code cannot pass as "nothing looks broken".
import { specPages } from "../../studio/lib/spec-core.mjs";

/** ```mermaid / ~~~mermaid fences in `markdown` (fence-aware: a fence inside another code block does not count). */
function countDiagrams(markdown) {
  let n = 0;
  let fence = null; // [char, length] of the open fence
  for (const line of markdown.split("\n")) {
    const f = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (!f) continue;
    if (!fence) {
      fence = [f[1][0], f[1].length];
      if (f[2] === "mermaid") n++;
    } else if (f[1][0] === fence[0] && f[1].length >= fence[1] && !f[2]) fence = null;
  }
  return n;
}

/**
 * markdown → { pages: [{ id, title, diagrams }], diagrams }: the sections /spec?…&p=all shows (section[data-spec-page]
 * with the page title as its heading) and how many diagrams each one draws. `lang` is the viewer's language ("en" by
 * default, what a fresh browser sees on the English example): the title of the intro page depends on it.
 */
export function expectedSpec(markdown, { lang = "en" } = {}) {
  const pages = specPages(markdown, { lang }).map((p) => ({ id: p.id, title: p.title, diagrams: countDiagrams(p.markdown) }));
  return { pages, diagrams: pages.reduce((s, p) => s + p.diagrams, 0) };
}

const SYMBOLS = [["**", /\*\*[^*\n]+\*\*|\*\*/], ["##", /(^|\n)\s*#{1,6}\s/], ["|---", /\|\s*:?-{3,}/], ["```", /```/], ["](", /\]\([^)]*\)/]];

/** Markdown left as text in the rendered page text → ["<symbol>: …text around it…"]. */
export function leftoverSymbols(text) {
  const out = [];
  for (const [name, re] of SYMBOLS) {
    const m = re.exec(text);
    if (m) out.push(`${name}: …${text.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\n/g, "⏎")}…`);
  }
  return out;
}

/**
 * What is wrong with a rendered spec page. `expected` = expectedSpec(markdown); `seen` = { pages: [{ id, title,
 * figures, drawn }], text } — the page's sections (data-spec-page, heading, figure.mmd count, figures holding an svg)
 * and its text. Empty = the page shows the whole spec, every diagram drawn, no markdown left as text.
 */
export function specProblems(expected, seen) {
  const out = [];
  if (expected.pages.length && !seen.pages.length) out.push(`no spec section shown (expected ${expected.pages.length}) — page text: "${seen.text.slice(0, 120).replace(/\n/g, "⏎")}"`);
  else {
    for (const want of expected.pages) {
      const got = seen.pages.find((p) => p.id === want.id);
      if (!got) { out.push(`section ${want.id} ("${want.title}") not shown`); continue; }
      if (got.title.trim() !== want.title) out.push(`section ${want.id}: heading "${got.title.trim()}" instead of "${want.title}"`);
      if (got.drawn !== want.diagrams || got.figures !== want.diagrams) {
        out.push(`${want.id}: ${got.drawn} of ${want.diagrams} diagram${want.diagrams === 1 ? "" : "s"} drawn (${got.figures} diagram figure${got.figures === 1 ? "" : "s"} on the page)`);
      }
    }
    for (const p of seen.pages) if (!expected.pages.some((w) => w.id === p.id)) out.push(`unexpected section ${p.id} ("${p.title}")`);
  }
  out.push(...leftoverSymbols(seen.text));
  return out;
}
