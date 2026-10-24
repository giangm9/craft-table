// The plain-language RULE (craft-table.json lint.plainLanguage): DESCRIPTIONS (boards, scenarios, the Behavior tab) are plain words for people to read;
// technical detail goes in the Technical tab. humanIssues(text) returns the offending fragments (empty = passes).
// Used in tests (studio/lib/spec-lint.test.mjs) and by the check tool — it blocks Claude in the studio too.
// Pure (no Node imports): the studio's editors run it in the browser as well.
//
// Two vocabularies, picked by the language of the CONTENT — the project's (option lang): what counts as
// jargon differs (an English reader knows "banner" or "session"; a Vietnamese one may not). The words live in the
// agent dictionary (lintTerms, lintHttpCode). Without a language the Vietnamese vocabulary applies — the rule as it
// was before the studio spoke two languages, which a project's own tests still call that way.
import AGENT from "./i18n/agent.mjs";

const DEFAULT_LANG = "vi";
const dict = (lang) => AGENT[lang] ?? AGENT.en;

// Structural rules, the same in every language.
const STRUCTURE = [
  [/`/g, () => "`"],                                                                  // code mark
  [/(?:^|[\s(“"'])((?:\/[a-z][\w-]*)+(?:\/[\w.*-]+)*)/gi, (m) => m[1]],              // /orders/list
  [/[\w.*-]+\/[\w.*-]+\/[\w.*/-]*(?::\d+(?:[-–]\d+)?)?/g, (m) => m[0]],             // refs/orders/x.png, src/a/b.ts:9
  [/\b[\w-]+\.(?:ts|tsx|js|mjs|sql|json|css|png|md)\b(?::\d+(?:[-–]\d+)?)?/g, (m) => m[0]], // file.ts:99
  [/\b[A-Z]{1,3}:\d+(?:[-–]\d+)?\b/g, (m) => m[0]],                                   // O:120, AB:42
  [/\b[a-z]+[A-Z][A-Za-z]*\b/g, (m) => m[0]],                                         // camelCase
  [/\b[a-z]+_[a-z_]+\b/g, (m) => m[0]],                                               // snake_case
  [/\|\||&&|===|!==|=>|!\w|\w=\w|[{}]/g, (m) => m[0]],                                // operators, braces
];
// A component tag in code form (<OrderList />). English projects only: the Vietnamese rule set stays as it was.
const JSX_TAG = [/<\/?[A-Z][A-Za-z0-9]*(?=[\s/>])/g, (m) => m[0]];

const cache = new Map();
function rulesFor(lang) {
  if (!cache.has(lang)) {
    const d = dict(lang);
    cache.set(lang, [
      ...STRUCTURE,
      [new RegExp(d.lintHttpCode, "gi"), (m) => m[1]],                                // HTTP status codes
      [/\b\d+\s?ms\b/g, (m) => m[0]],
      [new RegExp(`\\b(?:${d.lintTerms})\\b`, "gi"), (m) => m[0]],                     // jargon
      ...(lang === "en" ? [JSX_TAG] : []),
    ]);
  }
  return cache.get(lang);
}
const langOf = (lang) => (lang === "en" || lang === "vi" ? lang : DEFAULT_LANG);

/** Fragments of `text` that are not plain words (empty = passes). lang: the content's language ("vi" when not given). */
export function humanIssues(text, { lang = DEFAULT_LANG } = {}) {
  const out = new Set();
  const s = String(text ?? "");
  for (const [re, pick] of rulesFor(langOf(lang))) for (const m of s.matchAll(re)) out.add(pick(m));
  return [...out];
}

// A Mermaid diagram is allowed in the Behavior tab (it is a picture, not code for the reader), but the WORDS in it —
// node labels, edge labels, actor names, messages — must still be plain words.
const SKIP = /^\s*(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|erDiagram|journey|direction|classDef|class |style |linkStyle|%%|end\s*$|autonumber|activate|deactivate)/;
function mermaidLabels(line) {
  if (SKIP.test(line)) return [];
  const out = [];
  for (const m of line.matchAll(/\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\}|\|([^|]*)\||--\s+([^>-][^>]*?)\s+-->/g)) {
    out.push((m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "").replace(/^["(\[{]+|["\])}]+$/g, ""));
  }
  const as = /\bparticipant\s+\S+\s+as\s+(.+)$|\bactor\s+\S+\s+as\s+(.+)$/.exec(line);
  if (as) out.push(as[1] ?? as[2]);
  const msg = /(?:->>|-->>|->|-->|-x|--x|Note\s+\w+(?:\s+\w+)?(?:,\s*\w+)?)\s*[^:]*:\s*(.+)$/.exec(line);
  if (msg) out.push(msg[1]);
  return out;
}

/**
 * A whole Behavior tab → the places that are not plain words yet ("line: fragment"). Empty = passes.
 * lang: the content's language (picks the vocabulary; "vi" when not given). uiLang: the language of the issue texts
 * (a code block), for whoever reads them — Claude (the project's language) or a viewer in the studio; default = lang.
 */
export function behaviorIssues(markdown, { lang = DEFAULT_LANG, uiLang = lang } = {}) {
  const out = [];
  let fence = null; // null | "mermaid" | "code"
  String(markdown ?? "").split("\n").forEach((line, i) => {
    const f = /^\s*```\s*([\w-]*)/.exec(line);
    if (f) {
      if (fence) { fence = null; return; }
      fence = f[1] === "mermaid" ? "mermaid" : "code";
      if (fence === "code") out.push(`${i + 1}: ${dict(langOf(uiLang)).lintCodeBlock}`);
      return;
    }
    if (fence === "code") return;
    const texts = fence === "mermaid" ? mermaidLabels(line) : [line];
    for (const t of texts) for (const iss of humanIssues(t, { lang })) out.push(`${i + 1}: ${iss}`);
  });
  return out;
}
