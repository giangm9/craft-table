// The body of a spec tab: markdown + DIAGRAMS (```mermaid) + EMBEDDED CODE (```src path:from-to caption) read
// straight from the project's app source (craft-table.json "source"), syntax-highlighted, the excerpt highlighted.
// Clicking a source link (`src/...:line`) opens / closes a code box right below that line; Ctrl/⌘+click opens the
// full code page. Shared by the spec panel next to the board and the /spec page (opened on its own).
// The markdown is the project's and is never translated; the studio's own words around it come from i18n/spec.ts.
import { useEffect, useMemo, useRef } from "react";
import { Marked } from "marked";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import sql from "highlight.js/lib/languages/sql";
import json from "highlight.js/lib/languages/json";
import mermaid from "mermaid";
import { codeRef, shortRef, parseSrcFence } from "../lib/spec-core.mjs";
import { useProject } from "./project";
import { T } from "./i18n/spec";

type SrcScope = { roots: string[]; extensions: string[] } | null;
// The project's source scope (one per page): both rendering the markdown (marked renders synchronously) and
// embedding code use it. null = the project declares no source (or it has not loaded yet) → no links, no embeds.
let scope: SrcScope = null;

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("json", json);
mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", flowchart: { htmlLabels: false, curve: "basis" } });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const langOf = (p: string) => (/\.sql$/.test(p) ? "sql" : /\.json$/.test(p) ? "json" : /\.m?js$/.test(p) ? "javascript" : "typescript");

const md = new Marked({
  gfm: true,
  renderer: {
    html: () => "", // raw HTML is not accepted
    codespan({ text }) {
      const r = codeRef(unesc(text), scope);
      if (!r) return `<code class="ident">${text}</code>`;
      const q = `path=${encodeURIComponent(r.path)}${r.from ? `&from=${r.from}&to=${r.to}` : ""}`;
      const full = `${r.path}${r.from ? `:${r.from}${r.to !== r.from ? `-${r.to}` : ""}` : ""}`;
      return `<a class="src-ref" data-src="${esc(full)}" href="/__src?${q}${r.from ? `#L${r.from}` : ""}" target="_blank" rel="noreferrer" title="${esc(T.srcRefTitle(full))}">${shortRef(r)}</a>`;
    },
    strong({ tokens }) {
      const inner = this.parser.parseInline(tokens);
      const m = /^R(\d+)\.?$/.exec(inner.trim());
      return m ? `<strong class="rule" data-rule="R${m[1]}" title="${esc(T.ruleTitle(`R${m[1]}`))}">${inner}</strong>` : `<strong>${inner}</strong>`;
    },
    code({ text, lang }) {
      if (lang === "mermaid") return `<figure class="mmd" data-code="${esc(text)}"><figcaption>${esc(T.drawingDiagram)}</figcaption></figure>`;
      if (lang === "src") return `<div class="src-embed" data-src="${esc(text.trim())}"></div>`;
      const l = lang && hljs.getLanguage(lang) ? lang : undefined;
      const body = l ? hljs.highlight(text, { language: l }).value : esc(text);
      return `<pre class="code"><code class="hljs">${body}</code></pre>`;
    },
  },
});

let seq = 0;
const LH = 20; // px — height of one line of code (the excerpt is highlighted with a background)

async function hydrateSrc(el: HTMLElement) {
  if (el.dataset.done) return;
  el.dataset.done = "1";
  const f = parseSrcFence(el.dataset.src ?? "", scope);
  if (!f) { el.innerHTML = `<p class="src-err">${esc(T.srcBadFence(el.dataset.src ?? ""))}</p>`; return; }
  el.innerHTML = `<p class="src-load">${esc(T.srcLoading(shortRef(f)))}</p>`;
  const r = await fetch(`/__api/src?path=${encodeURIComponent(f.path)}&from=${f.from}&to=${f.to}&pad=3`);
  if (!r.ok) { el.innerHTML = `<p class="src-err">${esc(T.srcReadFailed(f.path, r.status))}</p>`; return; }
  const d = (await r.json()) as { path: string; start: number; lines: string[]; from: number; to: number; total: number; cut: boolean };
  const code = hljs.highlight(d.lines.join("\n"), { language: langOf(d.path) }).value;
  const a = d.from - d.start, b = Math.min(d.to, d.start + d.lines.length - 1) - d.start + 1;
  const nums = d.lines.map((_, i) => `<span class="${d.start + i >= d.from && d.start + i <= d.to ? "hit" : ""}">${d.start + i}</span>`).join("");
  const pageUrl = `/__src?path=${encodeURIComponent(d.path)}&from=${d.from}&to=${d.to}#L${d.from}`; // the full code page
  el.innerHTML = `
    <div class="src-head">
      <span class="src-file" title="${esc(d.path)}">${esc(shortRef({ path: d.path, from: d.from, to: d.to }))}</span>
      ${f.caption ? `<span class="src-cap">${esc(f.caption)}</span>` : ""}
      <a href="${pageUrl}" target="_blank" rel="noreferrer">${esc(T.openWholeFile)}</a>
    </div>
    <div class="src-body">
      <div class="src-gutter">${nums}</div>
      <pre style="--lh:${LH}px;background-image:linear-gradient(to bottom,transparent ${a * LH + 8}px,var(--src-hit) ${a * LH + 8}px,var(--src-hit) ${b * LH + 8}px,transparent ${b * LH + 8}px)"><code class="hljs">${code}</code></pre>
    </div>
    ${d.cut ? `<p class="src-more">${T.srcMore((t) => `<a href="${pageUrl}" target="_blank" rel="noreferrer">${esc(t)}</a>`)}</p>` : ""}`;
}

async function hydrateMermaid(el: HTMLElement) {
  if (el.dataset.done) return;
  el.dataset.done = "1";
  const src = el.dataset.code ?? "";
  try {
    const { svg } = await mermaid.render(`mmd-${++seq}`, src);
    el.innerHTML = svg;
  } catch (e) {
    // A diagram with a syntax error: show the error and its source so a person or the agent can fix it (checked in e2e).
    el.classList.add("mmd-err");
    el.innerHTML = `<figcaption>${esc(T.diagramError(String((e as Error).message ?? e).split("\n")[0]))}</figcaption><pre>${esc(src)}</pre>`;
    (window as Window & { __specErrors?: string[] }).__specErrors?.push(String(e));
  }
}

export function SpecBody({ markdown, className = "px-6 py-5" }: { markdown: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const source = useProject()?.source ?? null;
  const html = useMemo(() => {
    scope = source ? { roots: source.roots, extensions: source.extensions } : null;
    return md.parse(markdown, { async: false }) as string;
  }, [markdown, source]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>(".src-embed").forEach((el) => { void hydrateSrc(el); });
    root.querySelectorAll<HTMLElement>("figure.mmd").forEach((el) => { void hydrateMermaid(el); });
  }, [html]);

  return (
    <article
      ref={ref}
      className={`spec-md ${className} text-[14px] text-ink-800`}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.src-ref");
        if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
        e.preventDefault();
        // Open / close a code box right below the block holding the link (paragraph, list item, table cell).
        const host = a.closest("li, p, td, th, blockquote") ?? a.parentElement!;
        const key = a.dataset.src ?? "";
        const open = [...host.querySelectorAll<HTMLElement>(":scope > .src-embed.inline")].find((x) => x.dataset.src === key);
        if (open) { open.remove(); a.classList.remove("open"); return; }
        const box = document.createElement("div");
        box.className = "src-embed inline";
        box.dataset.src = key.includes(":") ? key : `${key}:1-40`;
        host.appendChild(box);
        a.classList.add("open");
        void hydrateSrc(box);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
