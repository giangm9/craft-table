// Specs on the board: two tabs — Behavior (plain words, for people) and Technical (code, API, DB). Files next to
// the board: boards/<id>.behavior.md, boards/<id>.tech.md.
// In the Technical tab, `src/...:line` becomes a link to the studio's READ-ONLY code page (/__src) — only the safe
// area of the project's source repo can be opened (safeSrcPath).
// Pure (no Node imports) — shared by the server and the UI. The one word it writes (the intro page's title) follows
// the { lang } its caller passes (the viewer's), from lib/i18n/data.mjs.
import { isValidEntryId } from "./entries.mjs";
import { dataText } from "./i18n/data.mjs";
import { specPageId } from "./legacy-values.mjs";

export const SPEC_KINDS = ["behavior", "tech"];

export function specName(entry, kind) {
  if (!SPEC_KINDS.includes(kind) || !isValidEntryId(entry)) return null;
  return `${entry}.${kind}.md`;
}

/**
 * Relative path inside the project's source repo that may be opened; invalid → null. `scope` = { roots, extensions }
 * from craft-table.json "source" (null = no source repo configured → nothing may be opened).
 * @typedef {{ roots: string[], extensions: string[] } | null} SrcScope
 * @param {unknown} p
 * @param {SrcScope} [scope]
 */
export function safeSrcPath(p, scope = null) {
  if (!scope || typeof p !== "string" || !p || p.length > 300) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(p)) return null; // blocks \, NUL, spaces, odd characters
  const ext = p.slice(p.lastIndexOf(".") + 1);
  if (!scope.roots.some((r) => p.startsWith(`${r}/`)) || !p.includes(".") || !scope.extensions.includes(ext)) return null;
  const segs = p.split("/");
  if (segs.some((s) => s === "" || s === "." || s === ".." || s.startsWith("."))) return null;
  return p;
}

const REF = /^([A-Za-z0-9._/-]+?)(?::(\d+)(?:-(\d+))?)?$/;

/** Text in `code` → {path, from, to} when it is a full source reference; otherwise null. */
/** @param {unknown} text @param {SrcScope} [scope] */
export function codeRef(text, scope = null) {
  const m = REF.exec(String(text ?? "").trim());
  if (!m) return null;
  const path = safeSrcPath(m[1], scope);
  if (!path) return null;
  const from = m[2] ? Number(m[2]) : null;
  return { path, from, to: m[3] ? Number(m[3]) : from };
}

const GENERIC = new Set(["index", "types", "api", "schema", "utils", "util", "helpers", "constants", "auth", "data", "client", "server"]);
/** Short label of a source link: "Today.tsx:14–88"; a generic file name gets its parent folder. */
export function shortRef({ path, from, to }) {
  const segs = path.split("/");
  const base = segs[segs.length - 1];
  const name = GENERIC.has(base.replace(/\.[^.]+$/, "")) && segs.length > 1 ? `${segs[segs.length - 2]}/${base}` : base;
  return from ? `${name}:${from}${to && to !== from ? `–${to}` : ""}` : name;
}

/** Block ```src <path>:<from>-<to> [caption]``` → an embedded code excerpt; lines are required. */
/** @param {unknown} text @param {SrcScope} [scope] */
export function parseSrcFence(text, scope = null) {
  const t = String(text ?? "").trim();
  const sp = t.search(/\s/);
  const r = codeRef(sp < 0 ? t : t.slice(0, sp), scope);
  if (!r || !r.from) return null;
  return { path: r.path, from: r.from, to: r.to, caption: sp < 0 ? "" : t.slice(sp).trim() };
}

/** Cut lines [from..to] with `pad` context lines on each side, clamped to the file, at most `cap` lines. */
export function sliceLines(lines, from, to, pad = 3, cap = 80) {
  const total = lines.length;
  const a = Math.max(1, from - pad);
  let b = Math.min(total, to + pad), cut = false;
  if (b - a + 1 > cap) { b = a + cap - 1; cut = true; }
  return { start: a, lines: lines.slice(a - 1, b), from, to, total, cut };
}

// d with stroke (U+0110, U+0111) is a letter of its own: NFD does not split it into d + a mark.
const D_STROKE = new RegExp(`[${String.fromCharCode(0x110, 0x111)}]`, "g");

/** Slug of a title, the id of a section in URLs: diacritics dropped (d with stroke → d), lowercase, words joined by "-". */
export function slugVi(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(D_STROKE, "d")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const RULE_DEF = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\*\*(R\d+)\.?\*\*/gm;

/**
 * Split a spec into PAGES for the table of contents: one page per `##`; a `##` with `###` gives one page per `###`
 * (the text before the first `###` becomes a page of its own when there is any). The part before the first `##`
 * (without the `#`) is the intro page, id "overview", titled in `opts.lang` ("en" | "vi", default "en": the
 * viewer's language; data.mjs specOverview). Headings inside code blocks do not count. A page's heading line is
 * dropped — the frame draws it.
 * → [{ id, title, group (parent ## title | null), depth (0|1), markdown, rules (rules DEFINED here) }]
 * @param {string} markdown
 * @param {{ lang?: string }} [opts]
 * @returns {{ id: string, title: string, group: string | null, depth: number, markdown: string, rules: string[] }[]}
 */
export function specPages(markdown, opts = {}) {
  const lines = String(markdown ?? "").split("\n");
  const heads = [];
  let fence = null;
  lines.forEach((l, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return; }
    if (fence) return;
    const h = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(l);
    if (h) heads.push({ i, level: h[1].length, title: h[2] });
  });
  const body = (a, b) => lines.slice(a, b).join("\n");
  const used = new Map();
  const uid = (s) => { const n = (used.get(s) ?? 0) + 1; used.set(s, n); return n > 1 ? `${s}-${n}` : s; };
  const page = (id, title, group, depth, md) => {
    const rules = [...new Set([...md.matchAll(RULE_DEF)].map((m) => m[1]))];
    return { id, title, group, depth, markdown: md, rules };
  };
  const out = [];
  const firstH2 = heads.findIndex((h) => h.level === 2);
  const introEnd = firstH2 < 0 ? lines.length : heads[firstH2].i;
  const intro = lines.slice(0, introEnd).filter((l, i) => !heads.some((h) => h.i === i && h.level === 1)).join("\n");
  if (intro.trim()) out.push(page(uid("overview"), dataText(opts?.lang ?? "en", "specOverview"), null, 0, intro));
  if (firstH2 < 0) return out;
  for (let k = firstH2; k < heads.length; k++) {
    const h = heads[k];
    if (h.level !== 2) continue;
    const id = uid(slugVi(h.title) || "section");
    let next = k + 1;
    while (next < heads.length && heads[next].level > 2) next++;
    const subs = heads.slice(k + 1, next).filter((x) => x.level === 3);
    const stop = next < heads.length ? heads[next].i : lines.length;
    if (!subs.length) { out.push(page(id, h.title, null, 0, body(h.i + 1, stop))); continue; }
    const pre = body(h.i + 1, subs[0].i);
    if (pre.trim()) out.push(page(id, h.title, h.title, 0, pre));
    subs.forEach((s, j) => {
      const sEnd = j + 1 < subs.length ? subs[j + 1].i : stop;
      out.push(page(`${id}/${uid(`${id}/${slugVi(s.title) || "section"}`).slice(id.length + 1)}`, s.title, h.title, 1, body(s.i + 1, sEnd)));
    });
  }
  return out;
}

/**
 * Index of page `id` in `pages`, -1 if none. Ids written with the old default slugs ("tong-quan", "muc", of earlier
 * versions) still find their page (lib/legacy-values.mjs specPageId) — an exact match wins.
 * @param {{ id: string }[]} pages
 * @param {string | null | undefined} id
 */
export function specPageIndex(pages, id) {
  if (typeof id !== "string") return -1;
  const i = pages.findIndex((p) => p.id === id);
  if (i >= 0) return i;
  const now = specPageId(id);
  return now === id ? -1 : pages.findIndex((p) => p.id === now);
}

/**
 * The page that defines rule Rn; failing that, the first page that mentions **Rn**; none → null.
 * @param {{ id: string, markdown: string, rules: string[] }[]} pages
 * @param {string} rule
 * @returns {string | null}
 */
export function ruleTarget(pages, rule) {
  const def = pages.find((p) => p.rules.includes(rule));
  if (def) return def.id;
  const re = new RegExp(`\\*\\*${rule}\\.?\\*\\*`);
  return pages.find((p) => re.test(p.markdown))?.id ?? null;
}
