// The "Conversation" tab: the threads of the open board. A thread is a whole conversation between people and Claude
// (Claude runs in the background and can edit the board). Marking an area on the canvas attaches a reference to the
// message being written ([#n] in the text); clicking the reference brings that area to the middle of the canvas.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, AtSign, CheckCheck, Hourglass, ImagePlus, LayoutPanelLeft, Loader2, Maximize2, MessageSquarePlus, Minimize2, Pencil, RotateCcw, Send, Sparkles, Square, SquareDashedMousePointer, Trash2, Undo2, X } from "lucide-react";
import { cn } from "../ui";
import { allRefs, dropMark, waitingForUser, DESIGN_ENTRY, featureOf, isDesignThread, mentionsOf, plainMentions, splitMentions } from "../lib/thread-core.mjs";
import { replyBlocks, replyPlain } from "../lib/reply-md.mjs";
import { enterAction } from "../lib/composer-keys.mjs";
import { api, refScenario, scenariosOf, uploadUrl, type Entry, type Ref, type RunChoices, type RunWith, type Thread } from "./api";
import { agentText } from "./i18n/agent-status";
import { T, threadTitle } from "./i18n/threads";

/** A mark waiting to be redrawn: the i-th mark being written, or a sent mark (message + position in it, thread-wide number #n). */
export type Redraw = { kind: "pending"; i: number } | { kind: "sent"; messageId: string; index: number; n: number };

type Props = {
  entry: Entry;
  /** Version being viewed: a new thread belongs to it. */
  version: string;
  threads: Thread[];
  activeId: string | null; // thread id; "new" = starting a new thread; null = the list
  pendingRefs: Ref[];
  annotating: boolean;
  onOpen: (id: string | null) => void;
  onToggleAnnotate: () => void;
  onRemovePending: (i: number) => void;
  onClearPending: () => void;
  onFocusRef: (key: string) => void;
  onChanged: () => Promise<void>;
  onClose?: () => void;
  /** The large composer in the middle of the screen is open (URL `soan=1`). */
  composeBig: boolean;
  onComposeBig: (on: boolean) => void;
  /** The main screen and its options share threads: short name of a screen of the group ("the main screen", "option “X”"). */
  memberLabel: (entryId: string) => string;
  /** "Redraw" on a mark → the next mark drawn on the canvas replaces it (keeping its number). */
  redraw: Redraw | null;
  onRedraw: (r: Redraw) => void;
  /** Every screen (and option) of the version: the "@" menu offers them, a mention shows its screen's title, a mark's label names its scenario. */
  entries: Entry[];
  /** A mention was clicked: go to that screen — the open conversation stays open. */
  onOpenScreen: (id: string) => void;
  /** Where Claude may run scripts — the backend name, null = off, undefined = not known yet (nothing shown). */
  scripts?: string | null;
  /** The models and effort levels the message box offers (undefined = not known yet: no pickers). */
  runChoices?: RunChoices;
  /** The marks list of the open thread is shown (URL `kh=1`). */
  refsOpen: boolean;
  onRefsOpen: (on: boolean) => void;
};

/** When something happened: the time today, else the date too (in the page's language). */
const hm = (iso: string) => {
  const d = new Date(iso);
  return T.stamp(d, d.toDateString() === new Date().toDateString());
};
const who = (a: string) => (a === "claude" ? "Claude" : a.split("@")[0]);
const titleOf = (t: Thread) => threadTitle(t.title);
type ScreenItem = { id: string; title: string };
/** What the message box shows for model and effort: the value, what to offer, and what a change does. */
type RunPick = { value: RunWith; choices: RunChoices; onChange: (patch: RunWith) => void };
/** A patch on a choice: an empty string takes the field back to the default (the field is dropped). */
const mergeRun = (base: RunWith, patch: RunWith): RunWith => {
  const out: Record<string, string> = { ...base };
  for (const [k, v] of Object.entries(patch)) { if (v) out[k] = v; else delete out[k]; }
  return out;
};
const DRAFT_KEY = "craft-table:run-with";
/** The last choice made for a NEW conversation (per browser). */
const readDraftRun = (): RunWith => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") as RunWith; } catch { return {}; } };
const writeDraftRun = (v: RunWith) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(v)); } catch { /* storage may be off */ } };
const PICK = "min-w-0 flex-1 @[35rem]:flex-none @[35rem]:max-w-[10rem] rounded-lg border border-ink-200 bg-surface px-1.5 py-1.5 text-[12px] text-ink-700 disabled:opacity-60";
/** A screen's name in the "@" menu and in a mention: its title, plus the option's name for an option. */
const screenName = (e: Entry) => (e.meta.option ? `${e.meta.title} · ${e.meta.option.name}` : e.meta.title) || e.id;
// A mark with no scenario lies on the first scenario's row (refScenario): show that scenario's name.
const scLabel = (entry: Entry, r: Ref) => { const id = refScenario(r, entry); return scenariosOf(entry).find((s) => s.id === id)?.title ?? id ?? ""; };

// data-* values ("da-bo", "lon", "loi", "dang-tai") are test hooks that projects' e2e tests select on: kept as they are.
function RefChip({ n, claude, onClick, pending, removed, onRemove, title }: { n: number | string; claude?: boolean; pending?: boolean; removed?: boolean; onClick?: () => void; onRemove?: () => void; title?: string }) {
  return (
    <span data-ref-chip={removed ? "da-bo" : ""} className={cn(
      "inline-flex items-center gap-0.5 align-baseline rounded-full text-[11px] font-semibold tabular-nums border",
      removed ? "border-ink-200 bg-ink-50 text-ink-400 line-through" : pending ? "border-dashed border-accent-500 text-accent-800 bg-accent-50" : claude ? "border-sky-300 bg-sky-50 text-sky-800" : "border-accent-300 bg-accent-50 text-accent-800",
    )}>
      {removed
        ? <span title={T.markRemoved} className="px-1.5 py-px">#{n}</span>
        : <button type="button" onClick={onClick} title={title} className="px-1.5 py-px hover:underline">{pending ? `+${n}` : `#${n}`}</button>}
      {onRemove && <button type="button" aria-label={T.chipRemove} onClick={onRemove} className="pr-1 opacity-70 hover:opacity-100"><X size={11} /></button>}
    </span>
  );
}

/** A row of the marks list: number, where (scenario · frame), the text inside the area; Redraw / Remove, or Restore. */
function RefRow(p: { chip: ReactNode; where: string; texts: string[]; status?: string; redrawing?: boolean; busy?: boolean; onRedraw: () => void; onRemove: () => void; onRestore?: () => void }) {
  const btn = "shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium disabled:opacity-50";
  return (
    <div data-ref-row className="flex items-center gap-2 py-1.5 text-xs">
      <span className="shrink-0">{p.chip}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-ink-700" title={p.where}>{p.where}{p.status && <span className="text-ink-400"> · {p.status}</span>}</p>
        {p.texts.length > 0 && <p className="truncate text-ink-500" title={p.texts.join(" · ")}>{p.texts.slice(0, 4).map((t) => `“${t}”`).join(", ")}</p>}
      </div>
      {p.onRestore ? (
        <button type="button" data-ref-restore onClick={p.onRestore} disabled={p.busy} className={cn(btn, "border-ink-200 text-ink-700 hover:bg-ink-50")}><Undo2 size={13} /> {T.restore}</button>
      ) : (
        <>
          <button type="button" data-ref-redraw onClick={p.onRedraw} disabled={p.busy} aria-pressed={!!p.redrawing} title={T.redrawHint} className={cn(btn, p.redrawing ? "bg-accent-700 border-accent-700 text-white" : "border-ink-200 text-ink-700 hover:bg-ink-50")}>
            <Pencil size={13} /> {p.redrawing ? T.redrawing : T.redraw}
          </button>
          <button type="button" data-ref-remove onClick={p.onRemove} disabled={p.busy} aria-label={T.removeMark} title={T.removeMark} className="shrink-0 p-1.5 rounded-lg text-ink-500 hover:bg-ink-100 hover:text-rose-700 disabled:opacity-50"><X size={15} /></button>
        </>
      )}
    </div>
  );
}

function StatusBadge({ t }: { t: Thread }) {
  if (t.agent.state === "running") return <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-50 text-sky-800"><Loader2 size={11} className="animate-spin" />{T.working}</span>;
  if (t.agent.state === "queued") return <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800" title={T.queuedHint}><Hourglass size={11} />{T.queuedBadge}</span>;
  if (t.agent.state === "error") return <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 text-rose-800">{T.errorBadge}</span>;
  if (t.status === "closed") return <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-ink-100 text-ink-600">{T.closedBadge}</span>;
  if (waitingForUser(t)) return <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 text-rose-800">{T.yourTurn}</span>;
  return null;
}

/** Message text with [#k] (k = the mark's position in the message) → a chip with the thread-wide number. */
function MessageText({ text, map, mention }: { text: string; map: (k: number) => ReactNode; mention: (id: string) => ReactNode }) {
  const parts = text.split(/(\[#\d+\]|@\[[a-z0-9][a-z0-9/_~-]*\])/g);
  return (
    <p className="text-sm whitespace-pre-wrap break-words text-ink-900">
      {parts.map((p, i) => {
        const m = /^\[#(\d+)\]$/.exec(p);
        if (m) return <Fragment key={i}>{map(Number(m[1]))}</Fragment>;
        const id = p.startsWith("@[") ? mentionsOf(p)[0] : undefined; // an @[…] that is no valid screen id stays text
        return <Fragment key={i}>{id ? mention(id) : p}</Fragment>;
      })}
    </p>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type MdNode = any; // tree of lib/reply-md.mjs (blocks: p h ul ol quote pre hr table · inline: text ref b i del code a br)

/**
 * Claude's reply: markdown built straight into React elements (NO injected HTML — see lib/reply-md.mjs), with [#k]
 * as mark chips, as in a person's message.
 */
function ReplyBody({ text, chip, mention }: { text: string; chip: (k: number) => ReactNode; mention: (id: string) => ReactNode }) {
  const tree = useMemo(() => replyBlocks(text) as MdNode[], [text]);
  const inl = (ns: MdNode[]): ReactNode => ns.map((n, i) => {
    switch (n.t) {
      case "ref": return <Fragment key={i}>{chip(n.k)}</Fragment>;
      case "b": return <strong key={i} className="font-semibold">{inl(n.c)}</strong>;
      case "i": return <em key={i}>{inl(n.c)}</em>;
      case "del": return <del key={i}>{inl(n.c)}</del>;
      case "code": return <code key={i} className="px-1 py-px rounded bg-ink-100 text-[12.5px] font-mono break-all">{n.v}</code>;
      case "a": return <a key={i} href={n.href} target="_blank" rel="noreferrer noopener" className="text-accent-700 underline">{inl(n.c)}</a>;
      case "br": return <br key={i} />;
      default: return <Fragment key={i}>{splitMentions(n.v).map((q, j) => (q.type === "mention" ? <Fragment key={j}>{mention(q.id)}</Fragment> : q.value))}</Fragment>;
    }
  });
  const blk = (bs: MdNode[]): ReactNode => bs.map((b, i) => {
    switch (b.t) {
      case "h": return <p key={i} className="font-semibold">{inl(b.c)}</p>;
      case "ul": return <ul key={i} className="list-disc pl-5 space-y-0.5">{b.items.map((it: MdNode[], j: number) => <li key={j}>{blk(it)}</li>)}</ul>;
      case "ol": return <ol key={i} start={b.start} className="list-decimal pl-5 space-y-0.5">{b.items.map((it: MdNode[], j: number) => <li key={j}>{blk(it)}</li>)}</ol>;
      case "quote": return <blockquote key={i} className="border-l-2 border-ink-300 pl-3 text-ink-600 space-y-1">{blk(b.c)}</blockquote>;
      case "pre": return <pre key={i} className="p-2 rounded-lg bg-ink-100 text-[12.5px] font-mono overflow-x-auto">{b.v}</pre>;
      case "hr": return <hr key={i} className="border-ink-200" />;
      case "table": return (
        <div key={i} className="overflow-x-auto">
          <table className="text-[13px] border-collapse">
            <thead><tr>{b.head.map((c: MdNode[], j: number) => <th key={j} className="border border-ink-200 px-2 py-1 text-left font-semibold bg-ink-50">{inl(c)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r: MdNode[][], j: number) => <tr key={j}>{r.map((c, k) => <td key={k} className="border border-ink-200 px-2 py-1 align-top">{inl(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      default: return <p key={i}>{inl(b.c)}</p>;
    }
  });
  return <div data-reply className="text-sm text-ink-900 break-words space-y-2">{blk(tree)}</div>;
}

const MAX_IMAGES = 6;
type Att = { key: string; url: string; id?: string; err?: string };

/**
 * The composer. Normally Enter sends and Shift+Enter starts a new line. The large composer (in the middle of the
 * screen, for multi-paragraph text; its state is in the URL `soan=1`): Enter starts a new line, Ctrl/⌘+Enter sends
 * (lib/composer-keys.mjs). Both modes are the same box (text, images and marks stay when switching).
 */
function Composer(p: { runPick?: RunPick; screens: ScreenItem[]; noMarks?: boolean; placeholder: string; draftKey: string; pendingRefs: Ref[]; entry: Entry; annotating: boolean; busy: boolean; expanded: boolean; onExpanded: (on: boolean) => void; onToggleAnnotate: () => void; onRemovePending: (i: number) => void; onFocusRef: (k: string) => void; redrawing: number | null; onRedraw: (i: number) => void; onSend: (text: string, images: string[]) => Promise<boolean> }) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Opening / folding the large composer → caret at the end of the text, to keep typing right away.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta || !p.expanded) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [p.expanded]);
  useEffect(() => {
    if (!p.expanded) return;
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") p.onExpanded(false); };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [p.expanded]); // eslint-disable-line react-hooks/exhaustive-deps
  const drafts = useRef(new Map<string, string>());
  // Attached images: pick a file / paste (Ctrl+V) / drag and drop → uploaded at once, sent as ids.
  const [atts, setAtts] = useState<Att[]>([]);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const clearAtts = () => setAtts((a) => { a.forEach((x) => URL.revokeObjectURL(x.url)); return []; });
  useEffect(() => clearAtts, [p.draftKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const addFiles = (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, MAX_IMAGES - atts.length));
    for (const f of imgs) {
      const key = `${Date.now()}-${Math.random()}`;
      setAtts((a) => [...a, { key, url: URL.createObjectURL(f) }]);
      api.upload(f).then(
        (id) => setAtts((a) => a.map((x) => (x.key === key ? { ...x, id } : x))),
        (e: Error) => setAtts((a) => a.map((x) => (x.key === key ? { ...x, err: e.message } : x))),
      );
    }
  };
  const uploading = atts.some((x) => !x.id && !x.err);
  const ready = atts.filter((x) => x.id).map((x) => x.id!);
  const [text, setText] = useState(() => drafts.current.get(p.draftKey) ?? "");
  useEffect(() => { setText(drafts.current.get(p.draftKey) ?? ""); }, [p.draftKey]);
  useEffect(() => { drafts.current.set(p.draftKey, text); }, [p.draftKey, text]);
  // A mark the text does not mention yet → append [#k], so the sentence points at the right area.
  // (Also runs when the composer has just opened: a mark drawn with no thread open opens the composer AFTER the
  // reference exists.)
  useEffect(() => {
    setText((t) => {
      let out = t;
      for (let k = 1; k <= p.pendingRefs.length; k++) if (!out.includes(`[#${k}]`)) out = `${out}${out && !out.endsWith(" ") ? " " : ""}[#${k}] `;
      return out;
    });
  }, [p.pendingRefs.length, p.draftKey]);
  // "@" mentions a screen: the word being typed after an "@" filters the screens; Enter / Tab / a click writes @[screen-id].
  const [caret, setCaret] = useState(0);
  const [menuIdx, setMenuIdx] = useState(0);
  const [menuOff, setMenuOff] = useState(false); // Esc closes the menu until the text changes again
  const mq = useMemo(() => {
    const m = /(^|[\s(])@([^\s@[\]]*)$/.exec(text.slice(0, caret));
    return m ? { start: caret - m[2].length - 1, query: m[2].toLowerCase() } : null;
  }, [text, caret]);
  const menuOpen = !!mq && !menuOff;
  const items = useMemo(() => (mq ? p.screens.filter((s) => !mq.query || s.title.toLowerCase().includes(mq.query) || s.id.toLowerCase().includes(mq.query)).slice(0, 30) : []), [mq, p.screens]);
  useEffect(() => { setMenuIdx(0); }, [mq?.query]);
  // The caret is put back RIGHT AFTER the new text is drawn (a layout effect, not a later frame): whoever types fast must not
  // have the caret jump back under the letters already typed.
  const caretTo = useRef<number | null>(null);
  const putCaret = (pos: number) => { caretTo.current = pos; setCaret(pos); };
  useLayoutEffect(() => {
    if (caretTo.current == null) return;
    const ta = taRef.current;
    ta?.focus();
    ta?.setSelectionRange(caretTo.current, caretTo.current);
    caretTo.current = null;
  });
  const chooseScreen = (s: ScreenItem) => {
    if (!mq) return;
    const ins = `@[${s.id}] `;
    setText(`${text.slice(0, mq.start)}${ins}${text.slice(caret)}`);
    putCaret(mq.start + ins.length);
  };
  const openMentionMenu = () => {
    const pos = taRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, pos);
    const gap = before && !/\s$/.test(before) ? " " : "";
    setText(`${before}${gap}@${text.slice(pos)}`);
    setMenuOff(false);
    putCaret(before.length + gap.length + 1);
  };
  const can = (text.trim() || p.pendingRefs.length || ready.length) && !p.busy && !uploading;
  const send = async () => {
    if (!can) return;
    if (!(await p.onSend(text.trim(), ready))) return;
    setText(""); drafts.current.delete(p.draftKey); clearAtts();
    if (p.expanded) p.onExpanded(false);
  };
  const box = (
    <div
      data-composer={p.expanded ? "lon" : ""}
      className={cn(
        "@container p-3 space-y-2 bg-surface",
        p.expanded ? "flex-1 min-h-0 flex flex-col" : "border-t border-ink-200",
        drag && "bg-accent-50 outline-2 outline-dashed outline-accent-400 -outline-offset-4",
      )}
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDrag(false); addFiles([...e.dataTransfer.files]); } }}
    >
      {p.pendingRefs.length > 0 && (
        <div data-pending-refs className="max-h-40 overflow-y-auto">
          {p.pendingRefs.map((r, i) => (
            <RefRow
              key={i}
              chip={<RefChip n={i + 1} pending onClick={() => p.onFocusRef(`pending:${i}`)} />}
              where={[scLabel(p.entry, r), r.viewport].filter(Boolean).join(" · ")}
              texts={r.texts}
              redrawing={p.redrawing === i}
              onRedraw={() => p.onRedraw(i)}
              // Removing mark i+1 → the text drops [#i+1] and later numbers shift down by one (still pointing at
              // the right areas).
              onRemove={() => { setText((t) => dropMark(t, i + 1)); p.onRemovePending(i); }}
            />
          ))}
        </div>
      )}
      {atts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {atts.map((a) => (
            <div key={a.key} data-attachment={a.id ?? (a.err ? "loi" : "dang-tai")} className={cn("relative w-16 h-16 rounded-lg border overflow-hidden bg-ink-50", a.err ? "border-rose-400" : "border-ink-200")} title={a.err ?? undefined}>
              <img src={a.url} alt="" className={cn("w-full h-full object-cover", (!a.id || a.err) && "opacity-50")} />
              {!a.id && !a.err && <Loader2 size={16} className="absolute inset-0 m-auto animate-spin text-ink-700" />}
              <button type="button" aria-label={T.removeImage} onClick={() => setAtts((x) => { URL.revokeObjectURL(a.url); return x.filter((y) => y.key !== a.key); })} className="absolute top-0.5 right-0.5 p-1 rounded-md bg-surface/90 border border-ink-200 text-ink-700 hover:text-rose-700"><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
      {atts.some((a) => a.err) && <p className="text-xs text-rose-700">{atts.find((a) => a.err)!.err}</p>}
      <textarea
        ref={taRef}
        value={text}
        onPaste={(e) => { const f = [...e.clipboardData.files].filter((x) => x.type.startsWith("image/")); if (f.length) { e.preventDefault(); addFiles(f); } }}
        onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); setMenuOff(false); }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (menuOpen && items.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setMenuIdx((i) => (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length); return; }
            if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) { e.preventDefault(); chooseScreen(items[Math.min(menuIdx, items.length - 1)]); return; }
          }
          if (menuOpen && e.key === "Escape") { e.preventDefault(); e.nativeEvent.stopPropagation(); setMenuOff(true); return; }
          const k = { key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode };
          if (enterAction(k, p.expanded) === "send") { e.preventDefault(); send(); }
        }}
        rows={3}
        placeholder={p.placeholder}
        className={cn("input resize-none", p.expanded && "flex-1 min-h-[40vh] text-[15px] leading-relaxed")}
      />
      {menuOpen && (
        <div role="listbox" aria-label={T.mentionMenu} data-mention-menu className="max-h-44 overflow-y-auto rounded-lg border border-ink-200 bg-surface shadow-sm divide-y divide-ink-100">
          {items.length === 0 ? <p className="px-3 py-2 text-xs text-ink-500">{T.mentionNone}</p> : items.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={i === Math.min(menuIdx, items.length - 1)}
              data-mention-id={s.id}
              onMouseDown={(e) => { e.preventDefault(); chooseScreen(s); }}
              className={cn("w-full text-left px-3 py-1.5 text-sm flex items-baseline gap-2", i === Math.min(menuIdx, items.length - 1) ? "bg-accent-50" : "hover:bg-ink-50")}
            >
              <span className="font-medium truncate">{s.title}</span>
              <span className="text-[11px] text-ink-400 truncate">{s.id}</span>
            </button>
          ))}
        </div>
      )}
      {/* The bottom row. Wide enough: Mark, @, Image, the two pickers, expand, Send on ONE line. Narrower: Mark, @, Image and expand + Send
          stay on the first line, the pickers fill a second one. (Container query on the message box, not on the window.) */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-1.5 @[35rem]:grid-cols-[auto_1fr_auto]">
       <div className="col-start-1 row-start-1 flex min-w-0 flex-wrap items-center gap-1.5">
        {!p.noMarks && <button
          type="button"
          onClick={() => { if (p.expanded && !p.annotating) p.onExpanded(false); p.onToggleAnnotate(); }}
          className={cn("inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium border", p.annotating ? "bg-accent-700 border-accent-700 text-white" : "bg-surface border-ink-200 text-ink-700 hover:bg-ink-50")}
          title={T.markHint}
        >
          <SquareDashedMousePointer size={15} /> {p.annotating ? T.marking : T.mark}
        </button>}
        <button
          type="button"
          data-mention-button
          onClick={openMentionMenu}
          className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium border bg-surface border-ink-200 text-ink-700 hover:bg-ink-50"
          title={T.mentionHint}
          aria-label={T.mention}
        >
          <AtSign size={15} />
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={atts.length >= MAX_IMAGES}
          className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium border bg-surface border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-50"
          title={T.attachHint(MAX_IMAGES)}
        >
          <ImagePlus size={15} /> {T.image}
        </button>
        <input ref={fileRef} data-image-input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
       </div>
        {p.runPick && (
          <span data-run-options className="col-span-2 row-start-2 flex min-w-0 items-center gap-1.5 @[35rem]:col-span-1 @[35rem]:col-start-2 @[35rem]:row-start-1">
            <select aria-label={T.runModel} title={`${T.runModel} — ${T.runHint}`} data-run-model value={p.runPick.value.model ?? ""} disabled={p.busy} onChange={(e) => p.runPick!.onChange({ model: e.target.value })} className={PICK}>
              <option value="">{T.runDefault(p.runPick.choices.defaultModel.label)}</option>
              {p.runPick.choices.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <select aria-label={T.runEffort} title={`${T.runEffort} — ${T.runHint}`} data-run-effort value={p.runPick.value.effort ?? ""} disabled={p.busy} onChange={(e) => p.runPick!.onChange({ effort: e.target.value })} className={PICK}>
              <option value="">{T.effortOption("")}</option>
              {p.runPick.choices.efforts.map((l) => <option key={l} value={l}>{T.effortOption(l)}</option>)}
            </select>
          </span>
        )}
       <div className="col-start-2 row-start-1 @[35rem]:col-start-3 ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => p.onExpanded(!p.expanded)}
          aria-label={p.expanded ? T.shrinkComposer : T.openBigComposer}
          title={p.expanded ? T.shrinkComposerHint : T.openBigComposerHint}
          className="self-stretch inline-flex items-center px-1.5 rounded-lg border border-ink-200 text-ink-600 hover:bg-ink-50 hover:text-ink-900"
        >
          {p.expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button type="button" onClick={send} disabled={!can} title={p.expanded ? T.sendHintBig : T.sendHint} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent-700 border border-accent-700 text-white rounded-lg text-sm font-medium hover:bg-accent-800 disabled:opacity-50">
          {p.busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {T.send}
        </button>
       </div>
      </div>
    </div>
  );
  if (!p.expanded) return box;
  // The large composer in the middle of the screen (phone: the whole screen). Backdrop / Esc / the shrink button →
  // back to the normal box, text kept.
  return (
    <div className="fixed inset-0 z-[60] bg-ink-900/40 flex items-stretch sm:items-center justify-center sm:p-6" onClick={() => p.onExpanded(false)}>
      <div data-composer-lon role="dialog" aria-label={T.compose} className="w-full sm:max-w-3xl h-full sm:h-[80vh] bg-surface sm:rounded-xl border border-ink-200 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-2.5 border-b border-ink-200 flex items-center gap-2">
          <p className="font-semibold flex-1">{T.compose}</p>
          <button type="button" aria-label={T.shrinkComposer} onClick={() => p.onExpanded(false)} className="p-1.5 rounded-lg hover:bg-ink-100"><X size={17} /></button>
        </div>
        {box}
      </div>
    </div>
  );
}

export function ThreadsPanel(p: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const listEnd = useRef<HTMLDivElement>(null);
  const thread = p.activeId && p.activeId !== "new" ? p.threads.find((t) => t.id === p.activeId) : undefined;
  const refs = thread ? allRefs(thread) : [];
  // Model and effort: a conversation keeps its own (saved at once, used from the next message); the next NEW one starts from the last choice made for a new one.
  const [draftRun, setDraftRun] = useState<RunWith>(readDraftRun);
  const draftPick: RunPick | undefined = p.runChoices && { value: draftRun, choices: p.runChoices, onChange: (patch) => { const next = mergeRun(draftRun, patch); setDraftRun(next); writeDraftRun(next); } };
  const threadPick: RunPick | undefined = p.runChoices && thread && { value: thread.runWith ?? {}, choices: p.runChoices, onChange: (patch) => { run(() => api.patchThread(thread.id, { runWith: mergeRun(thread.runWith ?? {}, patch) })); } };
  const screens = useMemo<ScreenItem[]>(() => p.entries.map((e) => ({ id: e.id, title: screenName(e) })), [p.entries]);
  const byId = (id: string) => p.entries.find((e) => e.id === id);
  /** A screen's name for a label; within the open screen's group (main screen + its options) the short names. */
  const onLabel = (id: string) => (featureOf(id) === featureOf(p.entry.id) ? p.memberLabel(id) : byId(id) ? screenName(byId(id)!) : id);
  /** A mention in a message: the screen's title as a link to it (a screen no longer in this version shows its id, struck through). */
  const mention = (id: string) => {
    const e = byId(id);
    return (
      <button
        type="button"
        data-mention={id}
        onClick={() => p.onOpenScreen(id)}
        title={e ? id : T.mentionGone}
        className={cn("inline-flex items-center gap-1 px-1.5 mx-px rounded-md border text-[12.5px] font-medium align-baseline", e ? "bg-accent-50 border-accent-200 text-accent-800 hover:bg-accent-100" : "bg-ink-50 border-ink-200 text-ink-400 line-through")}
      >
        <LayoutPanelLeft size={11} className="shrink-0" />{e ? screenName(e) : id}
      </button>
    );
  };
  /** A mark of a global thread is stamped with the screen it is drawn on (a thread of one screen needs no stamp). */
  const stamp = (rs: Ref[], global: boolean): Ref[] => (global ? rs.map((r) => ({ ...r, entry: r.entry ?? p.entry.id })) : rs);

  useEffect(() => { listEnd.current?.scrollIntoView({ block: "end" }); }, [thread?.messages.length, thread?.agent.state, agentText(thread?.agent.progress)]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr("");
    try { await fn(); await p.onChanged(); return true; } catch (e) { setErr(String((e as Error).message)); return false; } finally { setBusy(false); }
  };

  const header = (title: ReactNode, actions?: ReactNode, back = true) => (
    <div className="px-3 py-2.5 border-b border-ink-200 flex items-center gap-1.5">
      {back && <button type="button" aria-label={T.backToThreads} onClick={() => p.onOpen(null)} className="p-1.5 rounded-lg hover:bg-ink-100"><ArrowLeft size={17} /></button>}
      <div className="min-w-0 flex-1">{title}</div>
      {actions}
      {p.onClose && <button type="button" aria-label={T.close} onClick={p.onClose} className="p-1.5 rounded-lg hover:bg-ink-100"><X size={17} /></button>}
    </div>
  );

  // ── Starting a new thread ──
  if (p.activeId === "new") {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {header(<p className="font-semibold">{T.newThread}</p>)}
        <div className="flex-1" />
        {err && <p className="px-3 pb-2 text-xs text-rose-600">{err}</p>}
        <Composer
          placeholder={T.messageClaudeGlobal} screens={screens} runPick={draftPick}
          draftKey="new" entry={p.entry} pendingRefs={p.pendingRefs} annotating={p.annotating} busy={busy} expanded={p.composeBig} onExpanded={p.onComposeBig}
          onToggleAnnotate={p.onToggleAnnotate} onRemovePending={p.onRemovePending} onFocusRef={p.onFocusRef}
          redrawing={p.redraw?.kind === "pending" ? p.redraw.i : null} onRedraw={(i) => p.onRedraw({ kind: "pending", i })}
          onSend={(text, images) => run(async () => {
            const t = await api.createThread({ entry: DESIGN_ENTRY, version: p.version, text, refs: stamp(p.pendingRefs, true), images, viewing: p.entry.id, runWith: draftRun });
            p.onClearPending();
            p.onOpen(t.id);
          })}
        />
      </div>
    );
  }

  // ── One thread ──
  if (thread) {
    const lastUserUnanswered = thread.agent.state === "idle" && thread.messages[thread.messages.length - 1]?.role === "user";
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {header(
          <button type="button" onClick={() => { const v = prompt(T.renamePrompt, thread.title); if (v?.trim()) run(() => api.patchThread(thread.id, { title: v })); }} className="block w-full text-left font-semibold truncate hover:underline" title={T.rename}>
            {titleOf(thread)}
          </button>,
          <>
            {refs.length > 0 && (
              <button type="button" data-refs-toggle aria-expanded={p.refsOpen} title={T.marksToggle} onClick={() => p.onRefsOpen(!p.refsOpen)} className={cn("inline-flex items-center gap-1 px-1.5 py-1 rounded-lg text-xs font-medium tabular-nums", p.refsOpen ? "bg-accent-50 text-accent-800" : "text-ink-500 hover:bg-ink-100")}>
                <SquareDashedMousePointer size={16} /> {refs.filter((r) => !r.removed).length}
              </button>
            )}
            <button type="button" title={thread.status === "open" ? T.closeThread : T.reopenThread} onClick={() => run(() => api.patchThread(thread.id, { status: thread.status === "open" ? "closed" : "open" }))} className="p-1.5 rounded-lg text-ink-500 hover:bg-ink-100">
              {thread.status === "open" ? <CheckCheck size={17} /> : <RotateCcw size={17} />}
            </button>
            <button type="button" title={T.deleteThread} onClick={() => { if (confirm(T.deleteConfirm)) run(async () => { await api.deleteThread(thread.id); p.onOpen(null); }); }} className="p-1.5 rounded-lg text-ink-500 hover:bg-ink-100 hover:text-rose-700">
              <Trash2 size={16} />
            </button>
          </>,
        )}
        {p.refsOpen && refs.length > 0 && (
          <div data-ref-list className="shrink-0 max-h-60 overflow-y-auto px-3 py-1 border-b border-ink-200 bg-ink-50/60 divide-y divide-ink-100">
            {refs.map((r) => {
              const on = r.entry ?? thread.entry;
              const author = thread.messages.find((m) => m.id === r.messageId)?.author ?? "";
              const edit = (action: "remove" | "restore") => run(() => api.editRef(thread.id, { messageId: r.messageId, index: r.index, action }));
              return (
                <RefRow
                  key={`${r.messageId}:${r.index}`}
                  chip={<RefChip n={r.n} claude={r.role === "claude"} removed={!!r.removed} onClick={() => p.onFocusRef(`${r.messageId}:${r.index}`)} />}
                  where={[who(author), scLabel(byId(on) ?? p.entry, r), r.viewport, on !== p.entry.id ? T.onMember(onLabel(on)) : ""].filter(Boolean).join(" · ")}
                  texts={r.texts}
                  status={r.removed ? T.statusRemoved : r.redrawn ? T.statusRedrawn : ""}
                  busy={busy}
                  redrawing={p.redraw?.kind === "sent" && p.redraw.messageId === r.messageId && p.redraw.index === r.index}
                  onRedraw={() => p.onRedraw({ kind: "sent", messageId: r.messageId, index: r.index, n: r.n })}
                  onRemove={() => edit("remove")}
                  onRestore={r.removed ? () => edit("restore") : undefined}
                />
              );
            })}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          <div className="divide-y divide-ink-100">
            {thread.messages.map((m) => {
              const claude = m.role === "claude";
              const refOf = (k: number) => refs.find((r) => r.messageId === m.id && r.index === k - 1);
              return (
                <div key={m.id} className={cn("px-4 py-3", claude && "bg-sky-50/40")}>
                  <p className="flex items-center gap-1.5 text-xs text-ink-500 mb-1">
                    {claude && <Sparkles size={13} className="text-sky-600" />}
                    <span className={cn("font-medium", claude ? "text-sky-800" : "text-ink-700")}>{who(m.author)}</span> · {hm(m.at)}
                    {!claude && (isDesignThread(thread)
                      ? m.viewing && m.viewing !== p.entry.id && <span data-message-on className="truncate">· {T.lookingAt(byId(m.viewing) ? screenName(byId(m.viewing)!) : m.viewing)}</span>
                      : (m.viewing ?? thread.entry) !== p.entry.id && <span data-message-on className="truncate">· {T.onMember(onLabel(m.viewing ?? thread.entry))}</span>)}
                  </p>
                  {m.text && (() => {
                    const chip = (k: number) => { const r = refOf(k); return r ? <RefChip n={r.n} claude={claude} removed={!!r.removed} onClick={() => p.onFocusRef(`${m.id}:${k - 1}`)} /> : `[#${k}]`; };
                    return claude ? <ReplyBody text={m.text} chip={chip} mention={mention} /> : <MessageText text={m.text} map={chip} mention={mention} />;
                  })()}
                  {(m.images?.length ?? 0) > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {m.images!.map((id) => (
                        <a key={id} data-message-image={id} href={uploadUrl(id)} target="_blank" rel="noreferrer" className="block rounded-lg border border-ink-200 overflow-hidden hover:border-ink-400" title={T.openImage}>
                          <img src={uploadUrl(id)} alt={T.attachedImage} loading="lazy" className="h-24 max-w-[180px] object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                  {m.refs.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {m.refs.map((r, i) => (
                        <span key={i} className="inline-flex items-center gap-1 text-[11px] text-ink-500">
                          <RefChip n={refOf(i + 1)?.n ?? i + 1} claude={claude} removed={!!r.removed} onClick={() => p.onFocusRef(`${m.id}:${i}`)} title={r.texts.slice(0, 4).join(" · ")} />
                          <span className="truncate max-w-[160px]">{scLabel(byId(r.entry ?? thread.entry) ?? p.entry, r)} · {r.viewport}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {thread.agent.state === "running" && (
            <div className="mx-4 my-3 p-3 rounded-xl border border-sky-200 bg-sky-50 text-sm text-sky-900 flex items-start gap-2">
              <Loader2 size={16} className="animate-spin mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{T.workingLong}</p>
                {agentText(thread.agent.progress) && <p className="text-xs text-sky-800 truncate" title={agentText(thread.agent.progress)!}>{agentText(thread.agent.progress)}</p>}
              </div>
              <button type="button" onClick={() => run(() => api.stop(thread.id))} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-sky-300 hover:bg-sky-100"><Square size={11} />{T.stop}</button>
            </div>
          )}
          {thread.agent.state === "queued" && (
            <div data-queued className="mx-4 my-3 p-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-900 flex items-start gap-2">
              <Hourglass size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{T.waitingTurn}</p>
                <p className="text-xs text-amber-800">{T.busyElsewhere}</p>
                <button type="button" onClick={() => run(() => api.stop(thread.id))} className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-surface border border-amber-300 hover:bg-amber-100"><Square size={11} />{T.unqueue}</button>
              </div>
            </div>
          )}
          {thread.agent.state === "error" && (
            <div className="mx-4 my-3 p-3 rounded-xl border border-rose-200 bg-rose-50 text-sm text-rose-800 space-y-2">
              <p className="font-medium">{T.turnFailed}</p>
              {agentText(thread.agent.error) && <p className="text-xs whitespace-pre-wrap break-words">{agentText(thread.agent.error)}</p>}
              <button type="button" onClick={() => run(() => api.retry(thread.id))} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-rose-300 text-rose-800 rounded-lg text-sm font-medium hover:bg-rose-100"><RotateCcw size={14} />{T.runAgain}</button>
            </div>
          )}
          {lastUserUnanswered && (
            <div className="mx-4 my-3">
              <button type="button" onClick={() => run(() => api.retry(thread.id))} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-ink-200 text-ink-700 rounded-lg text-sm font-medium hover:bg-ink-50"><Sparkles size={14} />{T.askClaude}</button>
            </div>
          )}
          <div ref={listEnd} />
        </div>
        {err && <p className="px-3 pb-2 text-xs text-rose-600">{err}</p>}
        <Composer
          placeholder={thread.status === "closed" ? T.replyToReopen : T.reply}
          runPick={threadPick} screens={screens} noMarks={!isDesignThread(thread) && featureOf(thread.entry) !== featureOf(p.entry.id)} draftKey={thread.id} entry={p.entry} pendingRefs={p.pendingRefs} annotating={p.annotating} busy={busy} expanded={p.composeBig} onExpanded={p.onComposeBig}
          onToggleAnnotate={p.onToggleAnnotate} onRemovePending={p.onRemovePending} onFocusRef={p.onFocusRef}
          redrawing={p.redraw?.kind === "pending" ? p.redraw.i : null} onRedraw={(i) => p.onRedraw({ kind: "pending", i })}
          onSend={(text, images) => run(async () => { await api.send(thread.id, { text, refs: stamp(p.pendingRefs, isDesignThread(thread)), images, viewing: p.entry.id }); p.onClearPending(); })}
        />
      </div>
    );
  }

  // ── Thread list ──
  const open = p.threads.filter((t) => t.status === "open");
  const closed = p.threads.filter((t) => t.status === "closed");
  const row = (t: Thread) => {
    const last = t.messages[t.messages.length - 1];
    return (
      <button key={t.id} type="button" onClick={() => p.onOpen(t.id)} className="w-full text-left px-4 py-3 hover:bg-ink-50 block">
        <div className="flex items-start gap-2">
          <p className="font-medium text-sm text-ink-900 line-clamp-2 flex-1" title={titleOf(t)}>{titleOf(t)}</p>
          <StatusBadge t={t} />
        </div>
        {last && <p className="mt-0.5 text-xs text-ink-500 truncate">{last.role === "claude" ? T.fromClaude(plainMentions(replyPlain(last.text))) : plainMentions(last.text) || ((last.images?.length ?? 0) > 0 ? T.lastImage : T.lastMark)}</p>}
        <p className="mt-0.5 text-[11px] text-ink-400">{T.messageCount(t.messages.length)} · {hm(t.updatedAt)}{!isDesignThread(t) && t.entry !== p.entry.id && <span data-thread-on> · {onLabel(t.entry)}</span>}</p>
      </button>
    );
  };
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {header(<p className="font-semibold">{T.conversation}</p>, (
        <button type="button" onClick={() => p.onOpen("new")} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-accent-700 border border-accent-700 text-white rounded-lg text-sm font-medium hover:bg-accent-800">
          <MessageSquarePlus size={15} /> {T.newThread}
        </button>
      ), false)}
      {p.scripts !== undefined && <p data-scripts className="px-4 py-1 text-[11px] text-ink-400 border-b border-ink-100">{p.scripts ? T.scriptsOn(p.scripts) : T.scriptsOff}</p>}
      <div className="flex-1 overflow-y-auto">
        {p.threads.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink-500">
            {T.noThreadsGlobal}
          </div>
        ) : (
          <>
            <div className="divide-y divide-ink-100">{open.map(row)}</div>
            {closed.length > 0 && (
              <>
                <p className="px-4 pt-4 pb-1 text-[11px] uppercase tracking-wide font-medium text-ink-400">{T.closedCount(closed.length)}</p>
                <div className="divide-y divide-ink-100 opacity-80">{closed.map(row)}</div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
