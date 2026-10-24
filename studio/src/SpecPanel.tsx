// The spec is a PANEL ON THE LEFT, outside the board (inside the board, panning down would lose
// the spec). Two tabs sharing the rule numbers R1…Rn:
//   Behavior  — plain language for readers (boards/<id>.behavior.md)
//   Technical — code, API, DB, permissions, tests (boards/<id>.tech.md); `src/...:line` → link to /__src
// Table of contents + one page (SpecDoc); tab and page on the URL (sp, spp). Folds sideways into a thin strip, and
// its right edge drags to resize — two per-person choices kept on the device (the caller keeps them).
// Clicking "R5" in one tab → the other tab, ON THE PAGE that defines R5, with R5 scrolled to the middle.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { BookOpen, Check, ChevronsLeft, Code2, ExternalLink, FileText, Loader2, Pencil, X } from "lucide-react";
import { SegmentedControl, cn } from "../ui";
import { SpecDoc } from "./SpecDoc";
import { SpecEditor } from "./SpecEditor";
import type { Who } from "./collab";
import { ruleTarget, specPages } from "../lib/spec-core.mjs";
import { T } from "./i18n/spec";

export type SpecKind = "behavior" | "tech";
export const SPEC_MIN = 320, SPEC_MAX = 960;

async function load(version: string | undefined, entry: string, kind: SpecKind) {
  const r = await fetch(`/__api/spec?entry=${encodeURIComponent(entry)}&kind=${kind}${version ? `&v=${encodeURIComponent(version)}` : ""}`);
  return r.ok ? ((await r.json()) as { markdown: string }).markdown : null;
}

export function SpecPanel({
  version, entry, kind, page, onNav, onAvailable, collapsed, onCollapsed, width, onWidth, sheet, onClose, editing = false, onEditing, me, claudeBusy = false,
}: {
  /** Claude is running a turn on this screen (one queue per screen) → a strip says so. */
  claudeBusy?: boolean;
  /** Edit mode (editing together over Y.js) — on the URL (spe=1). */
  editing?: boolean;
  onEditing?: (on: boolean) => void;
  /** The viewer — name and cursor colour when editing together. Unknown → no Edit. */
  me?: Who | null;
  /** Version (versions/<v>); none → the live version. */
  version?: string;
  entry: string;
  kind: SpecKind;
  /** Page shown (table of contents id); null = the first page. */
  page: string | null;
  /** Change tab and/or page (page null = the tab's first page). */
  onNav: (kind: SpecKind, page: string | null) => void;
  onAvailable?: (has: boolean) => void;
  collapsed: boolean;
  onCollapsed: (c: boolean) => void;
  width: number;
  onWidth: (w: number) => void;
  /** Narrow screens: opens as a full-screen sheet (no folding, no resizing). */
  sheet?: boolean;
  onClose?: () => void;
}) {
  const [docs, setDocs] = useState<Record<SpecKind, string | null> | null>(null);
  const [pane, setPane] = useState<"write" | "preview">("write");
  const [draft, setDraft] = useState<string | null>(null);
  const canEdit = !!(me && version && onEditing);
  const [jump, setJump] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const reload = () => Promise.all([load(version, entry, "behavior"), load(version, entry, "tech")]).then(([behavior, tech]) => {
      if (!alive) return;
      setDocs({ behavior, tech });
      onAvailable?.(!!(behavior || tech));
    });
    setDocs(null);
    reload();
    import.meta.hot?.on("studio:spec", reload);
    return () => { alive = false; import.meta.hot?.off?.("studio:spec", reload); };
  }, [entry, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clicking Rn → that rule scrolled to the middle of the panel; any other page change → back to the top.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    if (jump) {
      box.querySelector(`[data-spec-page] [data-rule="${jump}"]`)?.scrollIntoView({ block: "center" });
      setJump(null);
    } else box.scrollTop = 0;
  }, [docs, kind, page]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dragging the right edge: the handle captures the pointer so the board's frame (an iframe) cannot steal the events.
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const clamp = (w: number) => Math.round(Math.max(SPEC_MIN, Math.min(SPEC_MAX, w, innerWidth - 480)));
  const onGripDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width };
  };
  const onGripMove = (e: RPointerEvent<HTMLDivElement>) => { if (drag.current) setLive(clamp(drag.current.w + e.clientX - drag.current.x)); };
  // Recomputed from where the pointer is released — `live` in the closure can be one render behind.
  const onGripUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (drag.current) onWidth(clamp(drag.current.w + e.clientX - drag.current.x));
    drag.current = null;
    setLive(null);
  };

  const has = !docs || !!(docs.behavior || docs.tech);

  if (!sheet && (collapsed || (!has && !editing))) {
    return (
      <aside data-spec-panel className="hidden md:flex w-10 shrink-0 border-r border-ink-200 bg-surface flex-col">
        <button
          type="button"
          aria-label={T.openSpec}
          disabled={!has && !canEdit}
          title={has ? T.openSpec : canEdit ? T.noSpecWrite : T.noSpec}
          onClick={() => { onCollapsed(false); if (!has && canEdit) onEditing!(true); }}
          className="flex-1 flex flex-col items-center gap-2 pt-3 text-ink-500 hover:bg-ink-50 hover:text-ink-900 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <FileText size={16} />
          <span className="text-xs font-medium tracking-wide" style={{ writingMode: "vertical-rl" }}>{T.spec}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      data-spec-panel
      style={sheet ? undefined : { width: live ?? width }}
      className={cn("shrink-0 bg-surface flex flex-col min-h-0 relative", sheet ? "w-full h-full" : "hidden md:flex border-r border-ink-200")}
    >
      <div className="px-4 pt-3 border-b border-ink-200">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-ink-400">
          <FileText size={14} /> {T.spec}
          <a href={`/spec?${version ? `v=${encodeURIComponent(version)}&` : ""}e=${encodeURIComponent(entry)}&k=${kind}${page ? `&p=${encodeURIComponent(page)}` : ""}`} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 normal-case tracking-normal font-medium text-accent-700 hover:underline">
            <ExternalLink size={13} /> {T.openSeparately}
          </a>
          {canEdit && (
            <button
              type="button"
              onClick={() => { setDraft(null); setPane("write"); onEditing!(!editing); }}
              className={cn("inline-flex items-center gap-1 px-2 py-1 rounded-md normal-case tracking-normal text-xs font-medium border", editing ? "bg-accent-700 border-accent-700 text-white" : "border-ink-200 text-ink-700 hover:bg-ink-50")}
            >
              {editing ? <><Check size={13} /> {T.done}</> : <><Pencil size={13} /> {T.edit}</>}
            </button>
          )}
          {sheet ? (
            <button type="button" aria-label={T.closeSpec} onClick={onClose} className="p-1 rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-900"><X size={16} /></button>
          ) : (
            <button type="button" aria-label={T.collapseSpec} title={T.collapse} onClick={() => onCollapsed(true)} className="p-1 rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-900"><ChevronsLeft size={16} /></button>
          )}
        </div>
        <div className="mt-1.5 flex gap-1">
          {([["behavior", T.behavior, BookOpen], ["tech", T.tech, Code2]] as const).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => onNav(k, null)}
              className={cn("inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px", kind === k ? "border-accent-700 text-accent-800" : "border-transparent text-ink-500 hover:text-ink-800")}
            >
              <Icon size={15} /> {docs && !docs[k] ? T.tabMissing(label) : label}
            </button>
          ))}
        </div>
      </div>
      {claudeBusy && (
        <div data-claude-busy className="mx-4 mt-2 px-3 py-2 rounded-lg border border-sky-200 bg-sky-50 text-xs text-sky-900 flex items-center gap-2">
          <Loader2 size={13} className="animate-spin shrink-0" />
          <span>{T.claudeBusy}</span>
        </div>
      )}
      {editing && canEdit ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-4 pt-2"><SegmentedControl ariaLabel={T.writeOrPreview} value={pane} onChange={setPane} options={[{ key: "write", label: T.write }, { key: "preview", label: T.preview }]} /></div>
          <div className={cn("flex-1 min-h-0 flex-col", pane === "write" ? "flex" : "hidden")}>
            <SpecEditor key={`${version}:${entry}:${kind}`} docName={`${version}/${entry}.${kind}.md`} me={me!} kind={kind} onText={setDraft} />
          </div>
          {pane === "preview" && (
            <div className="flex-1 min-h-0 overflow-y-auto">
              {draft ? <SpecDoc key={kind} markdown={draft} page={page} onPage={(id) => onNav(kind, id)} /> : <p className="p-6 text-sm text-ink-500">{T.noContent}</p>}
            </div>
          )}
        </div>
      ) : (
      <div
        ref={scrollRef}
        data-spec-scroll
        className="flex-1 min-h-0 overflow-y-auto select-text"
        onClick={(e) => {
          const r = (e.target as HTMLElement).closest("[data-rule]");
          if (!r || !docs) return;
          const rule = r.getAttribute("data-rule")!;
          const other: SpecKind = kind === "behavior" ? "tech" : "behavior";
          setJump(rule);
          onNav(other, docs[other] ? ruleTarget(specPages(docs[other]!), rule) : null);
        }}
      >
        {docs === null ? (
          <p className="p-6 text-sm text-ink-500">{T.loadingSpec}</p>
        ) : docs[kind] ? (
          <SpecDoc key={kind} markdown={docs[kind]!} page={page} onPage={(id) => onNav(kind, id)} />
        ) : (
          <p className="p-6 text-sm text-ink-500">{T.noContent}</p>
        )}
      </div>
      )}
      {!sheet && (
        <div
          data-spec-resize
          role="separator"
          aria-orientation="vertical"
          aria-label={T.resizeSpec}
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          className={cn("absolute top-0 -right-1 w-2 h-full cursor-col-resize z-10 hover:bg-accent-500/25", live != null && "bg-accent-500/35")}
        />
      )}
    </aside>
  );
}
