// The board's CODE pane (.tsx), EDITED TOGETHER, below the board: CodeMirror bound to the file's Y.js document over
// /__collab — other people's text and cursors show; the server writes the file ~1 second later → Vite updates the
// frame in place (React Fast Refresh). Half-typed code that breaks the syntax: the error line shows here and as a
// strip in the frame (no error overlay over the whole studio). Claude running a turn on this screen → a strip says
// so (Claude's changes merge into the text being typed).
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { Code2, Loader2, TriangleAlert, X } from "lucide-react";
import { cn } from "../ui";
import { boardError } from "../lib/vite-error.mjs";
import { editorsOf, openDoc, type Who } from "./collab";
import { T } from "./i18n/spec";

type Status = "connecting" | "saved" | "saving" | "offline";
type BoardErr = NonNullable<ReturnType<typeof boardError>>;

const theme = EditorView.theme({
  "&": { fontSize: "12.5px", height: "100%" },
  // A monospace font with every Vietnamese diacritic (a board's strings may be Vietnamese).
  ".cm-scroller": { fontFamily: '"DejaVu Sans Mono", ui-monospace, Menlo, Consolas, monospace', lineHeight: "1.55" },
  // A solid background: long lines scrolled sideways do not run over the line numbers.
  ".cm-gutters": { background: "var(--color-surface)", borderRight: "1px solid var(--color-ink-100)" },
  "&.cm-focused": { outline: "none" },
});

export function CodeEditor({ version, entry, me, claudeBusy, height, onHeight, onClose }: {
  version: string;
  entry: string;
  me: Who;
  claudeBusy?: boolean;
  height: number;
  onHeight: (h: number) => void;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [editors, setEditors] = useState<Who[]>([]);
  const [err, setErr] = useState<BoardErr | null>(null);
  const [live, setLive] = useState<number | null>(null); // height while dragging
  const file = `/versions/${version}/boards/${entry}.tsx`;

  useEffect(() => {
    const c = openDoc(`${version}/${entry}.tsx`, me);
    const undoManager = new Y.UndoManager(c.text);
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: c.text.toString(),
        extensions: [basicSetup, javascript({ jsx: true, typescript: true }), theme, yCollab(c.text, c.provider.awareness, { undoManager })],
      }),
    });
    const onStatus = () => {
      const st = c.provider.configuration.websocketProvider?.status;
      if (st !== "connected") setStatus("offline");
      else setStatus(c.provider.hasUnsyncedChanges ? "saving" : c.provider.synced ? "saved" : "connecting");
    };
    c.provider.on("status", onStatus);
    c.provider.on("synced", onStatus);
    c.provider.on("unsyncedChanges", onStatus);
    const onAware = () => setEditors(editorsOf(c.provider));
    c.provider.awareness?.on("change", onAware);
    onAware();
    return () => {
      c.provider.awareness?.off("change", onAware);
      view.destroy();
      undoManager.destroy();
      c.destroy();
    };
  }, [version, entry, me.email]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compile errors of this very file; cleared by the file's next update (once it compiles again).
  useEffect(() => {
    setErr(null);
    const onErr = (p: { err?: Parameters<typeof boardError>[0] }) => { const e = boardError(p.err, file); if (e) setErr(e); };
    const onUpd = (p: { updates?: { path?: string }[] }) => { if (p.updates?.some((u) => u.path?.endsWith(file))) setErr(null); };
    import.meta.hot?.on("vite:error", onErr);
    import.meta.hot?.on("vite:afterUpdate", onUpd);
    return () => { import.meta.hot?.off?.("vite:error", onErr); import.meta.hot?.off?.("vite:afterUpdate", onUpd); };
  }, [file]);

  // Drag the top edge to change the height (saved on release).
  const clamp = (h: number) => Math.max(160, Math.min(innerHeight - 220, h));
  const startResize = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = height;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setLive(clamp(h0 - (ev.clientY - y0)));
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setLive(null);
      onHeight(clamp(h0 - (ev.clientY - y0)));
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const label: Record<Status, string> = T.saveStatus;
  return (
    <section data-code-editor className="shrink-0 flex flex-col bg-surface border-t border-ink-200 min-h-0" style={{ height: live ?? height }}>
      <div onPointerDown={startResize} className="h-1.5 -mt-1 cursor-row-resize hover:bg-accent-200" title={T.resizeHeight} aria-label={T.resizeHeight} role="separator" />
      <div className="px-3 py-1.5 border-b border-ink-100 flex items-center gap-2 text-xs min-w-0">
        <Code2 size={14} className="text-ink-500 shrink-0" />
        <span className="font-medium text-ink-800 truncate" title={`versions/${version}/boards/${entry}.tsx`}>{entry.split("/").pop()}.tsx</span>
        <span className={cn("inline-flex items-center gap-1 shrink-0", status === "offline" ? "text-rose-700" : status === "saving" ? "text-amber-700" : "text-ink-500")}>
          <span className={cn("w-1.5 h-1.5 rounded-full", status === "offline" ? "bg-rose-500" : status === "saving" ? "bg-amber-500" : status === "saved" ? "bg-emerald-500" : "bg-ink-300")} />
          {label[status]}
        </span>
        <span data-editors={editors.length} className="ml-auto inline-flex items-center gap-1.5 text-ink-500 shrink-0" title={editors.map((e) => e.name).join(", ")}>
          {editors.slice(0, 5).map((e, i) => <span key={i} className="w-2.5 h-2.5 rounded-full border border-surface" style={{ background: e.color }} />)}
          {T.editors(editors.length)}
        </span>
        <button type="button" onClick={onClose} aria-label={T.closeCode} title={T.close} className="p-1 rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-900"><X size={15} /></button>
      </div>
      {claudeBusy && (
        <div className="px-3 py-1.5 border-b border-sky-200 bg-sky-50 text-xs text-sky-900 flex items-center gap-2">
          <Loader2 size={13} className="animate-spin shrink-0" /> {T.claudeBusy}
        </div>
      )}
      <div ref={host} className="flex-1 min-h-0 overflow-hidden [&_.cm-editor]:h-full" />
      {err && (
        <div data-code-error className="px-3 py-1.5 border-t border-rose-200 bg-rose-50 text-xs text-rose-900 flex items-start gap-2">
          <TriangleAlert size={14} className="shrink-0 mt-px" />
          <span className="min-w-0"><b>{T.errorAt(err.line)}</b> {err.message}</span>
        </div>
      )}
    </section>
  );
}
