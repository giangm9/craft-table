// The board list: section → group → board, each level folds (remembered in the browser).
// By default only the group being viewed is open; a folded group still shows its total of open threads.
// A search box (diacritics ignored): while searching, every match shows and folding is ignored.
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, GitBranch, Layers, Search, X } from "lucide-react";
import { cn } from "../ui";
import type { Entry } from "./api";
import type { Who } from "./collab";
import { boardStatusLabel, optionStatusLabel } from "./i18n/values";
import { T } from "./i18n/shell";

const KEY = "studio:nav-open";
/** d with stroke (U+0110, U+0111) has no decomposition under NFD, so search maps it to d by hand. */
const D_STROKE = new RegExp(`[${String.fromCharCode(0x110, 0x111)}]`, "g");
/** Search key: no diacritics (NFD, then every combining mark dropped), d with stroke → d, lower case. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(D_STROKE, "d").toLowerCase();
/** Map key of the boards with no section (shown as "Other"); a neutral code, so folding state does not depend on the language. */
const NO_SECTION = "";

function loadOpen(): Set<string> | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? new Set(JSON.parse(v)) : null;
  } catch {
    return null;
  }
}

type Props = {
  entries: Entry[];
  activeId?: string;
  openCount: (id: string) => number;
  /** Titles of the conversations behind a screen's badge (its tooltip). */
  openTitles?: (id: string) => string[];
  /** Other people viewing this screen (same version) → coloured dots. */
  peersAt?: (id: string) => Who[];
  onPick: (id: string) => void;
};

export function Sidebar({ entries, activeId, openCount, openTitles, peersAt, onPick }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => loadOpen() ?? new Set());
  const active = entries.find((e) => e.id === activeId);

  // Always open the path to the board being viewed.
  useEffect(() => {
    if (!active) return;
    const sec = `s:${active.meta.section ?? NO_SECTION}`;
    const grp = `g:${active.meta.section ?? NO_SECTION}/${active.meta.group ?? ""}`;
    setOpen((o) => (o.has(sec) && o.has(grp) ? o : new Set([...o, sec, grp])));
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify([...open])); } catch { /* private mode */ }
  }, [open]);

  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // Options (id "<screen>~<name>") sit indented under their main screen, not on their own in the group.
  const optionsOf = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries) if (e.meta.option) { const k = e.meta.option.of; if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); }
    return m;
  }, [entries]);

  const tree = useMemo(() => {
    const fq = fold(q.trim());
    const hit = (e: Entry) => fold(`${e.meta.title} ${e.meta.group ?? ""} ${e.id} ${e.meta.option?.name ?? ""}`).includes(fq);
    const m = new Map<string, Map<string, Entry[]>>();
    for (const e of entries) {
      if (e.meta.option && entries.some((x) => x.id === e.meta.option!.of)) continue;
      if (fq && !hit(e) && !(optionsOf.get(e.id) ?? []).some(hit)) continue;
      const s = e.meta.section ?? NO_SECTION;
      const g = e.meta.group ?? "";
      if (!m.has(s)) m.set(s, new Map());
      const gm = m.get(s)!;
      if (!gm.has(g)) gm.set(g, []);
      gm.get(g)!.push(e);
    }
    return m;
  }, [entries, q, optionsOf]);

  const searching = q.trim().length > 0;
  const withOptions = (list: Entry[]) => list.flatMap((e) => [e, ...(optionsOf.get(e.id) ?? [])]);
  const sum = (list: Entry[]) => withOptions(list).reduce((a, e) => a + openCount(e.id), 0);
  // A folded group or section still shows that people are inside.
  const peopleIn = (list: Entry[]) => {
    const m = new Map<string, Who>();
    for (const e of withOptions(list)) for (const w of peersAt?.(e.id) ?? []) if (!m.has(w.email)) m.set(w.email, w);
    return [...m.values()];
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-2 pt-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
            placeholder={T.searchBoards}
            aria-label={T.searchBoards}
            className="w-full h-7 pl-7 pr-7 text-[12px] bg-surface border border-ink-200 rounded-md outline-none focus:border-accent-500"
          />
          {searching && (
            <button type="button" aria-label={T.clearSearch} onClick={() => setQ("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-400 hover:text-ink-700"><X size={14} /></button>
          )}
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-1.5 space-y-0.5">
        {tree.size === 0 && <p className="px-3 py-4 text-sm text-ink-500">{T.noMatch(q)}</p>}
        {[...tree].map(([section, groups]) => {
          const sk = `s:${section}`;
          const sOpen = searching || open.has(sk);
          const sNotes = sum([...groups.values()].flat());
          return (
            <div key={section}>
              <button type="button" onClick={() => toggle(sk)} className="w-full flex items-center gap-1 px-1.5 pt-2 pb-0.5 text-[10px] uppercase tracking-wider font-semibold text-ink-400 hover:text-ink-700">
                <ChevronRight size={12} className={cn("transition-transform", sOpen && "rotate-90")} />
                <span className="flex-1 text-left">{section === NO_SECTION ? T.otherSection : section}</span>
                {!sOpen && <Dots who={peopleIn([...groups.values()].flat())} attr={{ "data-presence-group": section }} />}
                {!sOpen && sNotes > 0 && <Badge n={sNotes} />}
              </button>
              {sOpen && [...groups].map(([group, list]) => {
                const gk = `g:${section}/${group}`;
                const gOpen = searching || open.has(gk) || !group;
                const gNotes = sum(list);
                return (
                  <div key={group} className="mb-0.5">
                    {group && (
                      <button type="button" onClick={() => toggle(gk)} className="w-full flex items-center gap-1.5 h-7 px-1.5 rounded-md text-[13px] text-ink-700 hover:bg-ink-50">
                        <ChevronRight size={13} className={cn("text-ink-400 transition-transform shrink-0", gOpen && "rotate-90")} />
                        <span className="flex-1 text-left font-medium truncate">{group}</span>
                        {!gOpen && <Dots who={peopleIn(list)} attr={{ "data-presence-group": `${section}/${group}` }} />}
                        {!gOpen && gNotes > 0 ? <Badge n={gNotes} /> : <span className="text-[11px] text-ink-400 tabular-nums">{list.length}</span>}
                      </button>
                    )}
                    {gOpen && (
                      <div className={cn(group && "ml-3 pl-2 border-l border-ink-100")}>
                        {withOptions(list).map((e) => {
                          const isActive = e.id === activeId;
                          const opt = e.meta.option;
                          const n = openCount(e.id);
                          const sc = e.meta.scenarios?.length ?? 0;
                          const here = peersAt?.(e.id) ?? [];
                          return (
                            <a
                              key={e.id}
                              href={`?e=${encodeURIComponent(e.id)}`}
                              onClick={(ev) => { ev.preventDefault(); onPick(e.id); }}
                              data-option-of={opt?.of}
                              className={cn(
                                "flex items-center gap-2 h-7 px-2 rounded-md text-[13px] transition-colors",
                                opt && "ml-4",
                                isActive ? "bg-accent-700 text-white" : "text-ink-700 hover:bg-ink-50",
                              )}
                              title={opt ? T.optionRowTitle({ name: opt.name, of: e.meta.title, status: optionStatusLabel(opt.status) }) : sc ? T.boardRowTitle({ title: e.meta.title, n: sc }) : e.meta.title}
                            >
                              {/* Active row (white on accent-700): every secondary label is plain white, never a
                                  translucent white (white/70 measured 3.09:1 in dark mode). */}
                              {opt && <GitBranch size={13} className={cn("shrink-0", isActive ? "text-white" : "text-ink-400")} />}
                              <span className="truncate flex-1">{opt ? opt.name : e.meta.title}</span>
                              {opt?.status === "adopted" && <span className={cn("text-[10px] shrink-0", isActive ? "text-white" : "text-emerald-700")}>{optionStatusLabel("adopted")}</span>}
                              <Dots who={here} inverted={isActive} attr={{ "data-presence-entry": e.id }} />
                              {e.changed && !opt && (
                                <span data-changed={e.id} title={T.changedHint} aria-label={T.changedLabel} className={cn("w-2 h-2 rounded-full shrink-0", isActive ? "bg-white" : "bg-amber-500")} />
                              )}
                              {n > 0 ? (
                                <Badge n={n} inverted={isActive} title={T.attentionHint((openTitles?.(e.id) ?? []).join(", "))} />
                              ) : sc > 0 ? (
                                <span className={cn("inline-flex items-center gap-0.5 text-[11px] tabular-nums shrink-0", isActive ? "text-white" : "text-ink-400")} aria-label={T.scenarioCount(sc)}>
                                  <Layers size={11} />{sc}
                                </span>
                              ) : e.meta.status && !fold(e.meta.title).includes(fold(boardStatusLabel(e.meta.status))) ? (
                                <span className={cn("text-[10px] uppercase tracking-wide shrink-0", isActive ? "text-white" : "text-ink-400")}>{boardStatusLabel(e.meta.status)}</span>
                              ) : null}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

function Badge({ n, inverted, title }: { n: number; inverted?: boolean; title?: string }) {
  return (
    <span data-attention title={title} className={cn(
      "shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-semibold inline-flex items-center justify-center normal-case tracking-normal",
      inverted ? "bg-surface text-accent-800" : "bg-rose-600 text-white",
    )}>{n}</span>
  );
}

/** Coloured dots of the people viewing (3 at most). */
function Dots({ who, inverted, attr }: { who: Who[]; inverted?: boolean; attr: Record<string, string> }) {
  if (!who.length) return null;
  return (
    <span {...attr} className="flex items-center shrink-0" title={T.viewingNow(who.map((w) => w.name).join(", "))}>
      {who.slice(0, 3).map((w) => (
        <span key={w.email} className={cn("-ml-1 first:ml-0 w-2.5 h-2.5 rounded-full border", inverted ? "border-white" : "border-surface")} style={{ background: w.color }} />
      ))}
    </span>
  );
}
