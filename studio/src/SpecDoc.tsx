// A long spec → a TABLE OF CONTENTS on the left + ONE page on the right (not everything unfolded). A page = each
// `##`, or each `###` when the `##` has sub-sections (split by lib/spec-core.mjs specPages). The caller keeps the
// page shown (on the URL), so Back/Next work. `all` = every page unfolded on one page (for the check tools, printing).
// Shared by the spec panel next to the board and the /spec page. Page titles are the project's headings, except the
// intro page's, which specPages titles in the viewer's language.
import { useMemo, type ReactElement } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../ui";
import { specPageIndex, specPages } from "../lib/spec-core.mjs";
import { SpecBody } from "./SpecBody";
import { lang } from "./i18n/index";
import { T } from "./i18n/spec";

export type SpecPage = ReturnType<typeof specPages>[number];

const range = (p: SpecPage) => (p.rules.length ? (p.rules.length > 1 ? `${p.rules[0]}–${p.rules[p.rules.length - 1]}` : p.rules[0]) : "");

function Toc({ pages, cur, onPage }: { pages: SpecPage[]; cur: string; onPage: (id: string) => void }) {
  const rows: ReactElement[] = [];
  let group: string | null = null;
  pages.forEach((p) => {
    if (p.group && p.group !== group && p.depth === 1) {
      // A `##` with no text of its own before its sub-sections → a group label; clicking it opens the first one.
      const first = p.id;
      rows.push(
        <button key={`g:${p.group}`} type="button" onClick={() => onPage(first)} className="w-full text-left px-3 pt-2.5 pb-1 text-[13px] font-semibold text-ink-800 hover:text-accent-800">
          {p.group}
        </button>,
      );
    }
    group = p.group;
    const active = p.id === cur;
    rows.push(
      <button
        key={p.id}
        type="button"
        data-page={p.id}
        onClick={() => onPage(p.id)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "w-full flex items-baseline gap-2 text-left rounded-lg py-1.5 pr-2 text-[13px] leading-snug",
          p.depth ? "pl-6" : "pl-3 font-semibold",
          active ? "bg-accent-50 text-accent-800" : p.depth ? "text-ink-600 hover:bg-ink-50 hover:text-ink-900" : "text-ink-800 hover:bg-ink-50",
        )}
      >
        <span className="flex-1 min-w-0">{p.title}</span>
        {range(p) && <span className={cn("shrink-0 text-[11px] font-normal tabular-nums", active ? "text-accent-700" : "text-ink-400")}>{range(p)}</span>}
      </button>,
    );
  });
  return <>{rows}</>;
}

export function SpecDoc({ markdown, page, onPage, all = false, tocClassName }: {
  markdown: string;
  page: string | null;
  onPage: (id: string) => void;
  all?: boolean;
  /** Extra classes for the table of contents column (the /spec page: sticky while scrolling). */
  tocClassName?: string;
}) {
  const pages = useMemo(() => specPages(markdown, { lang }), [markdown]);
  if (!pages.length) return <p className="p-6 text-sm text-ink-500">{T.tabEmpty}</p>;
  const i = Math.max(0, specPageIndex(pages, page)); // old page ids (tong-quan…) still open their page
  const cur = pages[i];

  if (all) {
    return (
      <div>
        {pages.map((p) => (
          <section key={p.id} data-spec-page={p.id} className="border-b border-ink-100 last:border-0">
            <PageHead p={p} />
            <SpecBody markdown={p.markdown} className="px-6 pt-2 pb-5" />
          </section>
        ))}
      </div>
    );
  }

  const prev = pages[i - 1], next = pages[i + 1];
  return (
    // Layout by the width OF THIS BLOCK (container query), not the screen: in the narrow spec panel on the left the
    // table of contents is a select; wide enough (≥ 56rem) it becomes a column on the left.
    <div className="@container">
    <div className="@4xl:flex">
      {/* Narrow: the table of contents is a select above the page. */}
      <div className="@4xl:hidden px-4 pt-4">
        <select
          value={cur.id}
          data-toc-select
          onChange={(e) => onPage(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-surface border border-ink-200 rounded-lg"
          aria-label={T.toc}
        >
          {pages.map((p) => <option key={p.id} value={p.id}>{p.group && p.depth ? `${p.group} › ` : ""}{p.title}</option>)}
        </select>
      </div>
      <nav data-toc className={cn("hidden @4xl:block w-60 shrink-0 border-r border-ink-200 p-2", tocClassName)} aria-label={T.toc}>
        <p className="px-3 pt-1 pb-2 text-[10px] uppercase tracking-wider font-semibold text-ink-400">{T.toc}</p>
        <Toc pages={pages} cur={cur.id} onPage={onPage} />
      </nav>
      <section data-spec-page={cur.id} className="flex-1 min-w-0">
        <PageHead p={cur} />
        <SpecBody key={cur.id} markdown={cur.markdown} className="px-6 pt-2 pb-4" />
        <div className="flex items-center gap-2 px-6 pb-5 pt-1 text-sm">
          {prev && (
            <button type="button" onClick={() => onPage(prev.id)} className="inline-flex items-center gap-1 min-w-0 px-3 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50">
              <ChevronLeft size={16} className="shrink-0" /> <span className="truncate">{prev.title}</span>
            </button>
          )}
          {next && (
            <button type="button" onClick={() => onPage(next.id)} className="ml-auto inline-flex items-center gap-1 min-w-0 px-3 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50">
              <span className="truncate">{next.title}</span> <ChevronRight size={16} className="shrink-0" />
            </button>
          )}
        </div>
      </section>
    </div>
    </div>
  );
}

function PageHead({ p }: { p: SpecPage }) {
  return (
    <header className="px-6 pt-5">
      {p.group && p.depth === 1 && <p className="text-xs font-medium text-ink-500">{p.group}</p>}
      <h2 className="text-lg font-semibold text-ink-900">{p.title}</h2>
    </header>
  );
}
