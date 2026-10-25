// The design studio: board list (left, folds) · SPEC (second panel on the left, collapses sideways / drags wider)
// · infinite canvas (middle: one row of desktop + mobile frames per scenario, clickable like the real app)
// · right panel: the Conversation with Claude (a mark = a reference point inside a message).
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Code2, FileText, GitBranch, History, Languages, LogOut, Menu, MessageSquare, Pencil, SquareDashedMousePointer } from "lucide-react";
import "../ui/tokens.css";
import "./studio.css";
import { cn, Select } from "../ui";
import { api, type Project, refScenario, scenariosOf, viewportsOf, type Entry, type Ref, type Theme, type Thread, type Version, type Viewport } from "./api";
import { useUrlParams } from "./useUrlParams";
import { Canvas, useCanvas } from "./Canvas";
import { Frame, type Marker } from "./Frame";
import { ThreadsPanel, type Redraw } from "./ThreadsPanel";
import { PanelAside } from "./PanelAside";
import { PANEL_DEFAULT } from "../lib/panel-width.mjs";
import { HistoryPanel } from "./HistoryPanel";
import { MetaEditor } from "./MetaEditor";
import { CreateOptionDialog, OptionBar } from "./OptionsUi";
import { CodeEditor } from "./CodeEditor";
import { usePresence, whoFrom, type Peer, type Who } from "./collab";
import { DEFAULT_DEVICE, DEVICES, FULL_DEVICE } from "../lib/devices.mjs";
import { deviceName } from "./i18n/values";
import { LOCAL_USER, T } from "./i18n/shell";
import { LangSwitch } from "./i18n/LangSwitch";
import { SpecPanel, type SpecKind } from "./SpecPanel";
import { Sidebar } from "./Sidebar";
import { loadProject } from "./project";
import { allRefs, attentionOn, featureOf, isDesignThread, needsAttention } from "../lib/thread-core.mjs";
import { threadTitle } from "./i18n/threads";
import { afterRemovePending, placeDrawn } from "../lib/ref-redraw.mjs";

type VpMode = "both" | Viewport;

/** Each person once (two tabs are still one person). */
function uniqWho(list: Peer[]): Who[] {
  const m = new Map<string, Who>();
  for (const p of list) if (!m.has(p.who.email)) m.set(p.who.email, p.who);
  return [...m.values()];
}

/** Other people in the studio: a coloured circle with their initial; click → go to the screen they are viewing. */
function PeerAvatars({ peers, label, onPick }: { peers: Peer[]; label: (p: Peer) => string; onPick: (p: Peer) => void }) {
  const byWho = new Map<string, Peer>();
  for (const p of peers) if (!byWho.has(p.who.email)) byWho.set(p.who.email, p);
  const list = [...byWho.values()];
  return (
    <div data-presence={list.length} className="flex items-center shrink-0 pl-1.5" aria-label={T.othersHere(list.length)}>
      {list.slice(0, 4).map((p) => (
        <button
          key={p.who.email}
          type="button"
          onClick={() => onPick(p)}
          title={label(p)}
          aria-label={label(p)}
          className="-ml-1.5 w-7 h-7 rounded-full border-2 border-surface text-white text-xs font-semibold uppercase grid place-items-center hover:z-10"
          style={{ background: p.who.color }}
        >
          {p.who.name.slice(0, 1)}
        </button>
      ))}
      {list.length > 4 && <span className="-ml-1.5 w-7 h-7 rounded-full border-2 border-surface bg-ink-200 text-ink-700 text-[11px] font-semibold grid place-items-center">+{list.length - 4}</span>}
    </div>
  );
}

/** Wide enough (≥ md)? Mount EXACTLY ONE spec panel (left panel or overlay sheet): hiding one with CSS still mounts
 *  it, and in Edit mode it would open a second co-editing connection (one person shown as "2 people editing"). */
function useWide() {
  const q = "(min-width: 768px)";
  const [wide, setWide] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

// Each person's own preferences (not navigation state) → kept on this machine; skipped in private mode.
function useStored<V>(key: string, init: V): [V, (v: V) => void] {
  const [v, setV] = useState<V>(() => {
    try { const s = localStorage.getItem(key); return s == null ? init : (JSON.parse(s) as V); } catch { return init; }
  });
  const set = useCallback((n: V) => { setV(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* ignored */ } }, [key]);
  return [v, set];
}

/** One row = one scenario: its label (scaled against the zoom so it stays readable) + the frames. */
function ScenarioRow({ index, title, desc, focusMe, children }: { index: number; title?: string; desc?: string; focusMe: boolean; children: React.ReactNode }) {
  const { zoom, focus } = useCanvas();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusMe || !ref.current) return;
    const t = setTimeout(() => ref.current && focus(ref.current, 0.35), 600);
    return () => clearTimeout(t);
  }, [focusMe]); // eslint-disable-line react-hooks/exhaustive-deps
  const k = Math.min(1 / zoom, 4);
  return (
    <section ref={ref} className="space-y-1">
      {title && (
        <div className="relative h-20">
          <div className="absolute left-0 bottom-1 origin-bottom-left whitespace-nowrap" style={{ transform: `scale(${k})` }}>
            <p className="text-base font-semibold text-ink-900">
              <span className="text-ink-400 tabular-nums mr-1.5">{index + 1}.</span>{title}
            </p>
            {desc && zoom >= 0.62 && <p className="text-xs text-ink-500 max-w-[640px] whitespace-normal line-clamp-2">{desc}</p>}
          </div>
        </div>
      )}
      <div className="flex gap-16 items-start">{children}</div>
    </section>
  );
}

function App() {
  const [params, setParams] = useUrlParams();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [live, setLive] = useState("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [me, setMe] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [pendingRefs, setPendingRefs] = useState<Ref[]>([]);
  // "Redraw" on a mark → the next mark drawn replaces it (lib/ref-redraw.mjs). Leaving mark mode cancels it.
  const [redraw, setRedraw] = useState<Redraw | null>(null);
  useEffect(() => { if (!annotating) setRedraw(null); }, [annotating]);
  const [error, setError] = useState("");

  // Version being viewed: ?v= (when it exists) or the live one. List not known yet → wait.
  const vParam = params.get("v");
  const version = versions.some((x) => x.id === vParam) ? vParam! : live;
  const cmpParam = params.get("cmp");
  const compare = cmpParam && cmpParam !== version && versions.some((x) => x.id === cmpParam) ? cmpParam : null;
  const vTitle = (id: string | null) => versions.find((x) => x.id === id)?.title ?? id ?? "";
  const loadVersions = useCallback(() => api.versions().then((r) => { setVersions(r.versions); setLive(r.live); }).catch((e) => setError(String(e.message))), []);
  const loadEntries = useCallback(() => (version ? api.entries(version).then(setEntries).catch((e) => setError(String(e.message))) : Promise.resolve()), [version]);
  const loadThreads = useCallback(() => api.allThreads().then(setThreads).catch(() => {}), []);
  useEffect(() => {
    api.me().then((r) => setMe(r.email)).catch(() => {});
    loadProject().then(setProject).catch(() => {});
    loadVersions();
    loadThreads();
    // The server announces file changes over the HMR channel (no page reload); a poll covers a channel dropped by a tunnel.
    import.meta.hot?.on("studio:threads", loadThreads);
    import.meta.hot?.on("studio:versions", loadVersions);
    const t = setInterval(loadThreads, 15_000);
    addEventListener("focus", loadThreads);
    return () => { clearInterval(t); removeEventListener("focus", loadThreads); import.meta.hot?.off?.("studio:versions", loadVersions); };
  }, [loadVersions, loadThreads]);
  useEffect(() => {
    loadEntries();
    import.meta.hot?.on("studio:entries", loadEntries);
    return () => { import.meta.hot?.off?.("studio:entries", loadEntries); };
  }, [loadEntries]);

  const entry = entries.find((e) => e.id === params.get("e")) ?? entries[0];
  const theme: Theme = params.get("th") === "dark" ? "dark" : "light";
  const supported = entry ? viewportsOf(entry) : [];
  const narrow = innerWidth < 768;
  const vpParam = params.get("vp") as VpMode | null;
  const vpMode: VpMode =
    vpParam === "desktop" || vpParam === "mobile" ? (supported.includes(vpParam) ? vpParam : supported[0])
      : supported.length === 2 && !narrow ? "both" : supported.includes("mobile") && narrow ? "mobile" : supported[0];
  const shown: Viewport[] = vpMode === "both" ? ["desktop", "mobile"] : vpMode ? [vpMode] : [];
  // Device of the mobile frames (URL dev=): fixed size, scrolls inside; "full" = as tall as the content (old dev=ca-trang too).
  const device = params.get("dev") ?? DEFAULT_DEVICE;
  const scenarios = entry ? scenariosOf(entry) : [];
  const focusScenario = params.get("s");
  const tParam = params.get("t");
  const specKind: SpecKind = params.get("sp") === "tech" ? "tech" : "behavior";
  const meWho = useMemo(() => (me ? whoFrom(me) : null), [me]);
  // Who has the studio open, on which screen (other tabs) → avatars in the header + dots in the board list.
  const peers = usePresence(meWho, version ? { v: version, entry: entry?.id } : null);
  const peersAt = useCallback((id: string) => uniqWho(peers.filter((p) => p.where.v === version && p.where.entry === id)), [peers, version]);
  const wide = useWide();
  const [specCollapsed, setSpecCollapsed] = useStored("studio:specCollapsed", false);
  const [specWidth, setSpecWidth] = useStored("studio:specWidth", 420);
  const [codeHeight, setCodeHeight] = useStored("studio:codeHeight", 320);
  const [panelWidth, setPanelWidth] = useStored("studio:panelWidth", PANEL_DEFAULT);
  const codeOpen = params.get("code") === "1";
  const specSheet = params.get("spec") === "1";
  const specNav = (k: SpecKind, pg: string | null) => setParams({ sp: k === "tech" ? "tech" : null, spp: pg });
  const focusKey = params.get("rf");
  const panelOpen = params.get("panel") === "1";
  const navOpen = params.get("nav") === "1";

  // The main screen + its options = one group sharing threads (lib/thread-core.mjs).
  // Conversations belong to the version: the same list on every screen (a thread made on one screen before is in it too).
  const versionThreads = useMemo<Thread[]>(() => (version ? threads.filter((t) => t.version === version) : []), [threads, version]);
  /** Short name of a screen of the group (label of a thread / message that belongs to another screen than this one). */
  const memberLabel = (id: string) => {
    const e = entries.find((x) => x.id === id);
    if (!e) return id.includes("~") ? T.removedOption : T.mainScreen;
    return e.meta.option ? T.optionNamed(e.meta.option.name) : T.mainScreen;
  };
  /** Moving within the group keeps the open thread; moving to another group closes it. */
  // A global conversation stays open when the screen changes; a thread of one screen only within its group.
  const keepT = (id: string | null | undefined) => {
    const open = tParam && tParam !== "new" ? versionThreads.find((t) => t.id === tParam) : undefined;
    if (tParam === "new" || (open && isDesignThread(open))) return tParam;
    return id && entry && featureOf(id) === featureOf(entry.id) ? tParam : null;
  };
  // Claude is running a turn on this screen (one turn per screen at a time) → a strip on the spec panel.
  // A global turn is editing every screen of its version; a turn of one screen, that screen (and its options).
  const claudeBusy = !!entry && versionThreads.some((t) => t.agent.state === "running" && (isDesignThread(t) || featureOf(t.entry) === featureOf(entry.id)));
  const activeThread = tParam && tParam !== "new" ? versionThreads.find((t) => t.id === tParam) : undefined;
  // Count in the board list: threads waiting for a person's answer (Claude spoke last) or in error.
  // The red badge of a screen: conversations that wait for the person and concern it (a thread made on it, or a global conversation that mentions it).
  const attention = useCallback((id: string) => attentionOn(threads, version, id).length, [threads, version]);
  const attentionTitles = useCallback((id: string) => attentionOn(threads, version, id).map((t: Thread) => threadTitle(t.title)), [threads, version]);
  const needing = versionThreads.filter(needsAttention).length;

  // Another board → drop the marks being composed (they belong to the old board).
  useEffect(() => { setPendingRefs([]); setRedraw((r) => (r?.kind === "pending" ? null : r)); }, [entry?.id]);
  useEffect(() => { setRedraw((r) => (r?.kind === "sent" ? null : r)); }, [tParam]);
  const startRedraw = (r: Redraw) => {
    setRedraw(r);
    setAnnotating(true);
    if (innerWidth < 1024) setParams({ panel: null }, "replace"); // phone: close the chat sheet to draw on the canvas
  };

  // Markers on each frame: the marks of the open thread + the marks being composed.
  const markersFor = (sc: string | null, vp: Viewport): Marker[] => {
    if (!entry) return [];
    const out: Marker[] = [];
    if (activeThread) {
      for (const r of allRefs(activeThread)) {
        if (r.removed) continue; // removed mark: not shown on the canvas
        if ((r.entry ?? activeThread.entry) !== entry.id) continue; // mark drawn on another screen of the group
        if (r.viewport === vp && refScenario(r, entry) === sc) out.push({ key: `${r.messageId}:${r.index}`, n: r.n, rect: r.rect, tone: r.role === "claude" ? "claude" : "user" });
      }
    }
    pendingRefs.forEach((r, i) => { if (r.viewport === vp && refScenario(r, entry) === sc) out.push({ key: `pending:${i}`, n: i + 1, rect: r.rect, tone: "pending" }); });
    return out;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The target may be the window (a key forwarded from a frame) → no closest().
      const t = e.target;
      if (t instanceof Element && t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "c" || e.key === "C") setAnnotating((a) => !a);
      if (e.key === "Escape") setAnnotating(false);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const name = project?.name ?? "craft-table";
    document.title = entry ? `${entry.meta.title} · ${name}` : `${name} · craft-table`;
  }, [entry, project]);

  // A mark on another screen of the group (e.g. drawn on an option) → go to that screen, keep the thread.
  const focusRef = (key: string) => {
    const r = activeThread ? allRefs(activeThread).find((x) => `${x.messageId}:${x.index}` === key) : undefined;
    const on = r ? r.entry ?? activeThread!.entry : null;
    setParams({ rf: key, panel: innerWidth < 1024 ? null : params.get("panel"), ...(on && on !== entry?.id ? { e: on } : {}) }, "replace");
  };

  const rightTab = params.get("rp") === "history" ? "history" : "threads";
  // What sits under the tab bar (Conversation / History) must be flex-1 min-h-0, NOT h-full: h-full + the tab bar is
  // 44px taller than the panel on a long thread → the whole page scrolls and the composer drops below the edge
  // (tests/panel-height.e2e.mjs).
  const panel = entry && (
    <div className="h-full flex flex-col min-h-0">
      <div role="tablist" className="flex gap-0.5 px-1 pt-1.5 border-b border-ink-200 shrink-0">
        {([["threads", T.conversation, MessageSquare], ["history", T.history, History]] as const).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={rightTab === k}
            onClick={() => setParams({ rp: k === "history" ? "history" : null, hist: null })}
            className={cn("inline-flex min-w-0 items-center gap-1 px-1.5 py-2 text-[13px] font-medium whitespace-nowrap border-b-2 -mb-px", rightTab === k ? "border-accent-700 text-accent-800" : "border-transparent text-ink-500 hover:text-ink-800")}
          >
            <Icon size={14} className="shrink-0" /> <span className="truncate">{label}</span>{k === "threads" && needing > 0 ? <span data-attention-count className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[11px] font-semibold inline-flex items-center justify-center">{needing}</span> : k === "threads" && versionThreads.length ? <span className="text-xs text-ink-400 tabular-nums">{versionThreads.length}</span> : null}
          </button>
        ))}
      </div>
      {rightTab === "history" ? (
        <HistoryPanel version={version} entry={entry.id} threads={threads} selected={params.get("hist")} onSelect={(id) => setParams({ hist: id })} />
      ) : (
      <ThreadsPanel
        entry={entry}
        entries={entries}
        onOpenScreen={(id) => setParams({ e: id, t: keepT(id), rf: null, s: null, spp: null, hist: null, meta: null, vp: null, nav: null })}
        scripts={project?.agent ? project.agent.sandbox : undefined}
        version={version}
        threads={versionThreads}
        activeId={tParam}
        pendingRefs={pendingRefs}
        annotating={annotating}
        onOpen={(id) => setParams({ t: id, rf: null }, "replace")}
        onToggleAnnotate={() => setAnnotating((a) => !a)}
        onRemovePending={(i) => { setPendingRefs((r) => r.filter((_, j) => j !== i)); setRedraw((x) => afterRemovePending(x, i)); }}
        onClearPending={() => { setPendingRefs([]); setAnnotating(false); }}
        onFocusRef={focusRef}
        onChanged={loadThreads}
        onClose={panelOpen ? () => setParams({ panel: null }) : undefined}
        composeBig={params.get("soan") === "1"}
        onComposeBig={(on) => setParams({ soan: on ? "1" : null })}
        memberLabel={memberLabel}
        redraw={redraw}
        onRedraw={startRedraw}
        refsOpen={params.get("kh") === "1"}
        onRefsOpen={(on) => setParams({ kh: on ? "1" : null }, "replace")}
      />
      )}
    </div>
  );

  return (
    // A full-screen app: the page itself never scrolls (nothing that overflows may push it up); each pane scrolls itself.
    <div className="h-screen overflow-hidden flex bg-ink-50 text-ink-900">
      {navOpen && <div className="fixed inset-0 bg-ink-900/40 z-30 md:hidden" onClick={() => setParams({ nav: null })} />}
      <aside className={cn(
        "fixed inset-y-0 left-0 w-64 bg-surface border-r border-ink-200 z-40 flex flex-col transition-transform md:static md:translate-x-0",
        navOpen ? "translate-x-0" : "-translate-x-full",
      )}>
        <div className="p-4 border-b border-ink-200 flex items-center gap-2">
          {project?.logo
            ? <img src={project.logo} alt="" className="w-7 h-7 rounded-md" />
            : <span aria-hidden className="w-7 h-7 rounded-md bg-accent-700 text-white text-sm font-semibold inline-flex items-center justify-center">{(project?.name ?? "·").slice(0, 1).toUpperCase()}</span>}
          <div className="leading-tight min-w-0">
            <p className="font-brand text-lg text-ink-900 truncate">{project?.name ?? ""}</p>
            <p className="text-[11px] text-ink-500">{T.studioTagline}</p>
          </div>
        </div>
        <Sidebar entries={entries} activeId={entry?.id} openCount={attention} openTitles={attentionTitles} peersAt={peersAt} onPick={(id) => setParams({ e: id, t: keepT(id), rf: null, nav: null, vp: null, s: null, spp: null, spec: null, hist: null, meta: null, opt: null })} />
        {/* Foot: the viewer's language, then who is signed in. The same aside is the phone's board-list drawer. */}
        <div data-sidebar-foot className="p-3 border-t border-ink-200 space-y-2 text-xs text-ink-500">
          <div className="flex items-center gap-2">
            <Languages size={15} aria-hidden className="shrink-0 text-ink-400" />
            <LangSwitch className="flex-1 min-w-0" />
          </div>
          <div className="flex items-center gap-2">
            <span className="truncate flex-1">{me}</span>
            {me && me !== LOCAL_USER && (
              <a href="/__auth/logout" className="p-1.5 rounded-lg hover:bg-ink-100" aria-label={T.signOut} title={T.signOut}><LogOut size={15} /></a>
            )}
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="px-3 md:px-4 py-2.5 border-b border-ink-200 bg-surface flex items-center gap-2 flex-wrap">
          <button type="button" className="md:hidden p-2 rounded-lg hover:bg-ink-50" aria-label={T.boardList} onClick={() => setParams({ nav: "1" })}>
            <Menu size={20} />
          </button>
          <div className="min-w-[200px] flex-1">
            <p className="font-semibold truncate flex items-center gap-1.5">
              <span className="truncate">{entry?.meta.title ?? "…"}</span>
              {entry?.meta.option && (
                <span className="hidden md:inline-flex shrink-0 items-center gap-1 px-1.5 py-px rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-xs font-medium max-w-[200px]">
                  <GitBranch size={12} className="shrink-0" /><span className="truncate">{entry.meta.option.name}</span>
                </span>
              )}
              {entry && meWho && version && (
                <button type="button" onClick={() => setParams({ code: codeOpen ? null : "1" })} className={cn("hidden md:inline-flex shrink-0 p-1 rounded-md hover:bg-ink-100 hover:text-ink-800", codeOpen ? "text-accent-700 bg-accent-50" : "text-ink-400")} title={codeOpen ? T.closeCode : T.openCode} aria-label={T.boardCode} aria-pressed={codeOpen}>
                  <Code2 size={14} />
                </button>
              )}
              {entry && meWho && !entry.meta.option && version && (
                <button type="button" onClick={() => setParams({ opt: "new" })} className="shrink-0 p-1 rounded-md text-ink-400 hover:bg-ink-100 hover:text-ink-800" title={T.createOptionHint} aria-label={T.createOption}>
                  <GitBranch size={14} />
                </button>
              )}
              {entry && meWho && (
                <button type="button" onClick={() => setParams({ meta: params.get("meta") === "1" ? null : "1" })} className="shrink-0 p-1 rounded-md text-ink-400 hover:bg-ink-100 hover:text-ink-800" title={T.editScreenInfoHint} aria-label={T.editScreenInfo}>
                  <Pencil size={14} />
                </button>
              )}
            </p>
            <p className="text-xs text-ink-500 truncate">
              {scenarios.length > 1 && <span className="font-medium text-ink-600">{T.scenarioCount(scenarios.length)} · </span>}
              {entry?.meta.desc}
            </p>
          </div>
          {peers.length > 0 && (
            <PeerAvatars
              peers={peers}
              label={(p) => T.peerLabel({
                name: p.who.name,
                where: entries.find((x) => x.id === p.where.entry)?.meta.title ?? p.where.entry,
                version: p.where.v !== version ? versions.find((x) => x.id === p.where.v)?.title ?? p.where.v : undefined,
              })}
              onPick={(p) => setParams({ v: p.where.v === live ? null : p.where.v, e: p.where.entry ?? null, cmp: null, t: null, rf: null, s: null, spp: null, hist: null, meta: null })}
            />
          )}
          <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
            {versions.length > 0 && (
              <Select
                className="flex-1 min-w-[160px] md:flex-none max-w-[240px]"
                ariaLabel={T.version}
                value={version}
                onChange={(x) => {
                  if (x === "__manage") { location.href = `/versions${version !== live ? `?v=${encodeURIComponent(version)}` : ""}`; return; }
                  setParams({ v: x === live ? null : x, cmp: null, t: null, rf: null, s: null });
                }}
                options={[
                  ...versions.filter((x) => x.status !== "archived" || x.id === version).map((x) => ({ value: x.id, label: T.versionOption({ title: x.title, live: x.live }) })),
                  { value: "__manage", label: T.manageVersions },
                ]}
              />
            )}
            {versions.length > 1 && (
              <Select
                className="hidden md:block max-w-[200px]"
                ariaLabel={T.compare}
                value={compare ?? ""}
                onChange={(x) => setParams({ cmp: x || null })}
                options={[{ value: "", label: T.noCompare }, ...versions.filter((x) => x.id !== version).map((x) => ({ value: x.id, label: T.compareWith(x.title) }))]}
              />
            )}
            {shown.includes("mobile") && (
              <Select
                className="flex-1 min-w-[160px] md:flex-none max-w-[230px]"
                ariaLabel={T.phone}
                value={device}
                onChange={(d) => setParams({ dev: d === DEFAULT_DEVICE ? null : d }, "replace")}
                // Narrow screen: the device name only (its size is written above each frame) so this select shares a
                // row with the Version select.
                options={[
                  ...DEVICES.map((d) => ({ value: d.id, label: wide ? `${deviceName(d)} · ${d.w}×${d.h}` : deviceName(d) })),
                  { value: FULL_DEVICE, label: wide ? T.fullDeviceWide : deviceName({ id: FULL_DEVICE }) },
                ]}
              />
            )}
            {supported.length === 2 && (
              <Select
                className="hidden md:block"
                ariaLabel={T.frames}
                value={vpMode}
                onChange={(v) => setParams({ vp: v })}
                options={[{ value: "both", label: T.viewportBoth }, { value: "desktop", label: T.viewport.desktop }, { value: "mobile", label: T.viewport.mobile }]}
              />
            )}
            {entry && (
              <button
                type="button"
                onClick={() => (innerWidth < 768 ? setParams({ spec: "1" }) : setSpecCollapsed(!specCollapsed))}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border",
                  !specCollapsed ? "md:bg-accent-50 md:border-accent-200 md:text-accent-800 bg-surface border-ink-200 text-ink-700" : "bg-surface border-ink-200 text-ink-700 hover:bg-ink-50",
                )}
                title={specCollapsed ? T.openSpec : T.collapseSpec}
              >
                <FileText size={15} /> <span className="hidden sm:inline">{T.spec}</span>
              </button>
            )}
            <Select
              ariaLabel={T.theme}
              value={theme}
              onChange={(v) => setParams({ th: v === "dark" ? "dark" : null })}
              options={[{ value: "light", label: T.themeLight }, { value: "dark", label: T.themeDark }]}
            />
            <button
              type="button"
              onClick={() => setAnnotating((a) => !a)}
              className={cn(
                // Fixed width: "Mark" ↔ "Marking" does not resize the button → the header does not wrap differently and
                // the canvas is not pushed.
                "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border md:min-w-[150px]",
                annotating ? "bg-accent-700 border-accent-700 text-white hover:bg-accent-800" : "bg-surface border-ink-200 text-ink-700 hover:bg-ink-50",
              )}
              title={T.markHint}
            >
              <SquareDashedMousePointer size={15} />
              {annotating ? (redraw ? T.redrawing(redraw.kind === "pending" ? `+${redraw.i + 1}` : `#${redraw.n}`) : T.marking) : T.mark}
              <kbd className={cn("hidden md:inline text-[10px] px-1 rounded border", annotating ? "border-white/40" : "border-ink-200 text-ink-400")}>C</kbd>
            </button>
            <button
              type="button"
              onClick={() => setParams({ panel: "1" })}
              className="lg:hidden inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-ink-200 text-ink-700 rounded-lg text-sm font-medium hover:bg-ink-50"
              aria-label={T.conversation}
            >
              <MessageSquare size={15} /> {versionThreads.length}
            </button>
          </div>
        </header>
        {error && <div className="p-3 text-sm bg-rose-50 text-rose-800 border-b border-rose-200">{error}</div>}
        {entry?.meta.option && version && (
          <OptionBar
            version={version}
            entry={entry}
            main={entries.find((x) => x.id === entry.meta.option!.of)}
            confirm={(["rename", "adopt", "remove"] as const).find((x) => x === params.get("opt")) ?? null}
            onConfirm={(c) => setParams({ opt: c })}
            onGoMain={() => setParams({ e: entry.meta.option!.of, t: keepT(entry.meta.option!.of), rf: null, s: null, spp: null, hist: null, meta: null, opt: null })}
            onDone={() => setParams({ e: entry.meta.option!.of, t: keepT(entry.meta.option!.of), rf: null, s: null, spp: null, hist: null, meta: null, opt: null }, "replace")}
          />
        )}
        {entry && !entry.meta.option && version && params.get("opt") === "new" && (
          <CreateOptionDialog
            version={version}
            entry={entry}
            entries={entries}
            onClose={() => setParams({ opt: null })}
            onCreated={(ids) => { loadEntries().then(() => setParams({ e: ids[0], opt: null, t: keepT(ids[0]), rf: null, s: null, spp: null, hist: null, meta: null }, "replace")); }}
          />
        )}

        <div className="flex-1 flex min-h-0">
          {entry && wide && (
            <SpecPanel
              claudeBusy={claudeBusy}
              me={meWho}
              editing={params.get("spe") === "1"}
              onEditing={(on) => setParams({ spe: on ? "1" : null })}
              version={version}
              entry={entry.id}
              kind={specKind}
              page={params.get("spp")}
              onNav={specNav}
              collapsed={specCollapsed}
              onCollapsed={setSpecCollapsed}
              width={specWidth}
              onWidth={setSpecWidth}
            />
          )}
          {entry ? (
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <Canvas fitKey={`${version}:${entry.id}:${vpMode}:${compare ?? ""}:${device}`} annotating={annotating}>
              <div className="flex flex-col gap-24">
                {scenarios.map((sc, i) => (
                  <ScenarioRow key={sc.id ?? "_"} index={i} title={sc.title} desc={sc.desc} focusMe={!!sc.id && sc.id === focusScenario}>
                    {shown.map((vp) => (
                      <Frame
                        key={`${version}:${entry.id}:${sc.id}:${vp}:${theme}`}
                        entry={entry}
                        version={version}
                        device={device}
                        versionLabel={compare ? vTitle(version) : undefined}
                        scenario={sc.id}
                        viewport={vp}
                        theme={theme}
                        markers={markersFor(sc.id, vp)}
                        annotating={annotating}
                        focusKey={focusKey}
                        onMarker={focusRef}
                        onRef={({ rect, texts }) => {
                          const placed = placeDrawn(pendingRefs, redraw, { scenario: sc.id, viewport: vp, rect, texts, entry: entry.id });
                          setPendingRefs(placed.pending);
                          if (placed.sent && activeThread) {
                            api.editRef(activeThread.id, { ...placed.sent, action: "redraw" }).then(loadThreads).catch((e) => setError(String(e.message)));
                          }
                          if (redraw) {
                            // Redrawn (once) → leave mark mode; on a phone, reopen the chat sheet to see the list.
                            setAnnotating(false);
                            if (innerWidth < 1024) setParams({ panel: "1" }, "replace");
                          } else if (!activeThread) {
                            // No thread open → open the new-thread composer to attach the area just marked.
                            setParams({ t: "new", panel: innerWidth < 1024 ? "1" : null }, "replace");
                          }
                        }}
                      />
                    ))}
                    {compare && (
                      // Frames of the compared version: their own group, an accent left border to spot it at any zoom.
                      <div data-compare={compare} className="flex gap-16 items-start pl-16 border-l-8 border-accent-300">
                        {shown.map((vp) => (
                          <Frame
                            key={`cmp:${compare}:${entry.id}:${sc.id}:${vp}:${theme}`}
                            entry={entry}
                            version={compare}
                            device={device}
                            versionLabel={vTitle(compare)}
                            scenario={sc.id}
                            viewport={vp}
                            theme={theme}
                            markers={[]}
                            annotating={false}
                            focusKey={null}
                            onMarker={() => {}}
                            onRef={() => {}}
                          />
                        ))}
                      </div>
                    )}
                  </ScenarioRow>
                ))}
              </div>
            </Canvas>
            {codeOpen && wide && meWho && version && (
              <CodeEditor
                key={`${version}:${entry.id}`}
                version={version}
                entry={entry.id}
                me={meWho}
                claudeBusy={claudeBusy}
                height={codeHeight}
                onHeight={setCodeHeight}
                onClose={() => setParams({ code: null })}
              />
            )}
            </div>
          ) : (
            <p className="flex-1 p-6 text-sm text-ink-500">{version ? T.noBoards(version) : ""}</p>
          )}
          <PanelAside width={panelWidth} onWidth={setPanelWidth}>{panel}</PanelAside>
          {entry && specSheet && !wide && (
            <div className="md:hidden fixed inset-0 z-50 bg-surface flex flex-col">
              <SpecPanel
                sheet
                onClose={() => setParams({ spec: null })}
                claudeBusy={claudeBusy}
                me={meWho}
                editing={params.get("spe") === "1"}
                onEditing={(on) => setParams({ spe: on ? "1" : null })}
                version={version}
                entry={entry.id}
                kind={specKind}
                page={params.get("spp")}
                onNav={specNav}
                collapsed={false}
                onCollapsed={() => {}}
                width={specWidth}
                onWidth={() => {}}
              />
            </div>
          )}
          {entry && meWho && version && params.get("meta") === "1" && (
            <MetaEditor version={version} entry={entry.id} me={meWho} onClose={() => setParams({ meta: null })} />
          )}
          {panelOpen && (
            <div className="lg:hidden fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-ink-900/40" onClick={() => setParams({ panel: null })}>
              <div data-panel className="w-full sm:w-96 h-[85vh] sm:h-full bg-surface rounded-t-xl sm:rounded-none border-l border-ink-200 flex flex-col" onClick={(e) => e.stopPropagation()}>
                {panel}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
