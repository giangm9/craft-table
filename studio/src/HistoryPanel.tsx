// HISTORY of a screen (right panel, "History" tab): each snapshot is the content of one of the screen's files (board,
// info, Behavior, Technical) at the moment someone stopped editing it. Opening a snapshot shows its diff against the
// current content; Restore writes the snapshot's content back as a NEW change (no snapshot is ever deleted). The open
// snapshot is on the URL (hist=<id>).
import { Fragment, createElement, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, History, RotateCcw } from "lucide-react";
import { diffLines } from "diff";
import { Badge, Button, ConfirmDialog, InlineNotice, LoadError, cn } from "../ui";
import type { Thread } from "./api";
import { storedText, type StoredText } from "./i18n/agent-status";
import { T } from "./i18n/history";
import { locale } from "./i18n/index";
import { authorLabel, V } from "./i18n/values";

/** note: { key, params } written by the studio (shown with storedText), or the text of a row written by earlier versions. */
type Rev = { id: number; version: string; path: string; ts: string; author: string; source: "human" | "claude" | "external" | "restore" | "option" | "init"; threadId: string | null; note: StoredText | null };

const FILE_LABEL: Array<[string, keyof typeof T.file]> = [[".behavior.md", "behavior"], [".tech.md", "tech"], [".meta.json", "meta"], [".tsx", "board"]];
const fileLabel = (p: string) => {
  const k = FILE_LABEL.find(([s]) => p.endsWith(s))?.[1];
  return k ? T.file[k] : p;
};
const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, T.timeFormat);
const day = (iso: string) => new Date(iso).toLocaleDateString(locale, T.dayFormat);
/** Parts of a rich text (dictionary function) → one node, no keys needed. */
const rich = (parts: ReactNode[]) => createElement(Fragment, null, ...parts);

function who(r: Rev, threads: Thread[]) {
  if (r.source === "claude") return r.threadId ? T.claudeInThread(threads.find((t) => t.id === r.threadId)?.title ?? null) : "Claude";
  if (r.source === "init") return V.author.init;
  if (r.source === "external") return V.author.external;
  return r.author === "claude@local" ? T.localClaude : authorLabel(r.author);
}
const SOURCE_BADGE: Partial<Record<Rev["source"], [keyof typeof T.badge, string]>> = {
  restore: ["restore", "bg-sky-50 text-sky-800 border border-sky-200"],
  option: ["option", "bg-amber-50 text-amber-800 border border-amber-200"],
  init: ["init", "bg-ink-100 text-ink-600 border border-ink-200"],
};

/** Line diff CURRENT → SNAPSHOT; long unchanged runs are folded (3 lines of context kept). */
function Diff({ from, to }: { from: string; to: string }) {
  const parts = useMemo(() => diffLines(from, to), [from, to]);
  if (!parts.some((p) => p.added || p.removed)) return <p className="p-4 text-sm text-ink-500">{T.sameAsCurrent}</p>;
  const rows: Array<{ kind: "add" | "del" | "same" | "fold"; text: string }> = [];
  parts.forEach((p, i) => {
    const lines = p.value.replace(/\n$/, "").split("\n");
    if (p.added || p.removed) { for (const l of lines) rows.push({ kind: p.added ? "add" : "del", text: l }); return; }
    const keepHead = i === 0 ? 0 : 3, keepTail = i === parts.length - 1 ? 0 : 3;
    if (lines.length <= keepHead + keepTail + 2) { for (const l of lines) rows.push({ kind: "same", text: l }); return; }
    for (const l of lines.slice(0, keepHead)) rows.push({ kind: "same", text: l });
    rows.push({ kind: "fold", text: T.unchangedLines(lines.length - keepHead - keepTail) });
    for (const l of lines.slice(lines.length - keepTail)) rows.push({ kind: "same", text: l });
  });
  return (
    <pre className="text-[12px] leading-5 font-mono overflow-x-auto">
      {rows.map((r, i) => (
        <div
          key={i}
          data-diff={r.kind}
          className={cn(
            "px-3 whitespace-pre-wrap break-words",
            r.kind === "add" && "bg-emerald-50 text-emerald-900",
            r.kind === "del" && "bg-rose-50 text-rose-900 line-through decoration-rose-300",
            r.kind === "fold" && "text-ink-400 italic bg-ink-50",
            r.kind === "same" && "text-ink-600",
          )}
        >
          <span className="select-none inline-block w-4 text-ink-400">{r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "}</span>{r.text || " "}
        </div>
      ))}
    </pre>
  );
}

export function HistoryPanel({ version, entry, threads, selected, onSelect }: {
  version: string;
  entry: string;
  threads: Thread[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [revs, setRevs] = useState<Rev[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ revision: Rev & { content: string }; current: string | null } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetch(`/__api/history?v=${encodeURIComponent(version)}&entry=${encodeURIComponent(entry)}`)
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => setRevs(d.revisions))
      .catch((e) => setError(String(e.message || e)));
  }, [version, entry]);
  useEffect(() => {
    setRevs(null);
    load();
    import.meta.hot?.on("studio:history", load);
    return () => { import.meta.hot?.off?.("studio:history", load); };
  }, [load]);

  useEffect(() => {
    setDetail(null);
    if (!selected) return;
    fetch(`/__api/history/${encodeURIComponent(selected)}`).then(async (r) => (r.ok ? setDetail(await r.json()) : setError(T.openSnapshotFailed(r.status)))).catch((e) => setError(String(e)));
  }, [selected]);

  const groups = useMemo(() => {
    const g = new Map<string, Rev[]>();
    for (const r of revs ?? []) { const k = day(r.ts); g.set(k, [...(g.get(k) ?? []), r]); }
    return [...g];
  }, [revs]);

  if (selected) {
    const r = detail?.revision;
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 py-2 border-b border-ink-200 flex items-center gap-2">
          <button type="button" onClick={() => onSelect(null)} className="inline-flex items-center gap-1 text-sm text-accent-700 hover:underline"><ArrowLeft size={14} /> {T.backToHistory}</button>
          {r && <Button className="ml-auto" onClick={() => { setDone(null); setConfirm(true); }}><RotateCcw size={14} /> {T.restore}</Button>}
        </div>
        {!r ? (
          error ? <div className="p-3"><LoadError what={T.loadSnapshot} detail={error} onRetry={() => onSelect(selected)} /></div> : <p className="p-4 text-sm text-ink-500">{T.loading}</p>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="px-3 py-2 text-sm">
              <p className="font-medium text-ink-900">{T.snapshotHeading({ file: fileLabel(r.path), day: day(r.ts), time: time(r.ts) })}</p>
              <p className="text-xs text-ink-500">{who(r, threads)}{r.note ? ` · ${storedText(r.note)}` : ""}</p>
              <p className="mt-2 text-xs text-ink-600">
                {rich(T.restoreLegend(
                  (w) => <span className="px-1 bg-emerald-50 text-emerald-900">{w}</span>,
                  (w) => <span className="px-1 bg-rose-50 text-rose-900">{w}</span>,
                ))}
              </p>
              {done && <div className="mt-2"><InlineNotice tone="success">{done}</InlineNotice></div>}
            </div>
            {detail!.current === null ? <InlineNotice tone="warning">{T.fileGone}</InlineNotice> : <Diff from={detail!.current} to={r.content} />}
          </div>
        )}
        {confirm && r && (
          <ConfirmDialog
            title={T.restoreTitle({ file: fileLabel(r.path), day: day(r.ts), time: time(r.ts) })}
            confirmLabel={T.restoreConfirm}
            busy={busy}
            onCancel={() => setConfirm(false)}
            onConfirm={async () => {
              setBusy(true);
              const res = await fetch(`/__api/history/${r.id}/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
              setBusy(false); setConfirm(false);
              if (res.ok) { setDone(T.restored); load(); onSelect(null); } else setError(T.restoreFailed(res.status));
            }}
          >
            <p>{T.restoreKeepsCurrent}</p>
          </ConfirmDialog>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {error ? (
        <div className="p-3"><LoadError what={T.loadHistory} detail={error} onRetry={load} /></div>
      ) : revs === null ? (
        <p className="p-4 text-sm text-ink-500">{T.loading}</p>
      ) : !revs.length ? (
        <div className="p-6 text-center text-sm text-ink-500"><History size={20} className="mx-auto mb-2 text-ink-400" />{T.noSnapshots}</div>
      ) : (
        groups.map(([d, rs]) => (
          <section key={d}>
            <p className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide font-semibold text-ink-400">{d}</p>
            {rs.map((r) => (
              <button
                key={r.id}
                type="button"
                data-rev={r.id}
                data-source={r.source}
                onClick={() => onSelect(String(r.id))}
                className="w-full text-left px-3 py-2 border-b border-ink-100 hover:bg-ink-50 flex items-start gap-2"
              >
                {/* min-w, not w: a 12-hour clock ("09:05 AM") is wider than the 24-hour one. */}
                <span className="text-xs tabular-nums text-ink-500 min-w-10 whitespace-nowrap shrink-0 pt-0.5">{time(r.ts)}</span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium text-ink-900">{fileLabel(r.path)}</span>
                    {SOURCE_BADGE[r.source] && <Badge className={SOURCE_BADGE[r.source]![1]}>{T.badge[SOURCE_BADGE[r.source]![0]]}</Badge>}
                  </span>
                  <span className="block text-xs text-ink-500 truncate">{who(r, threads)}</span>
                </span>
              </button>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
