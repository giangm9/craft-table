// The spec editor, EDITED TOGETHER (Behavior / Technical): CodeMirror bound to the Y.js document of the .md file
// over /__collab — other people's text and cursors show as they type; the server writes the file ~1 second later
// (git, Vite and the history all see it). Behavior tab: the "plain language" rule is checked live on the text.
import { useEffect, useRef, useState } from "react";
import { basicSetup } from "codemirror";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { InlineNotice, cn } from "../ui";
import { behaviorIssues } from "../lib/spec-lint.mjs";
import { liveMarks } from "../lib/md-live.mjs";
import { editorsOf, openDoc, type Who } from "./collab";
import { T } from "./i18n/spec";
import { lang } from "./i18n/index";
import { useProject } from "./project";

type Status = "connecting" | "saved" | "saving" | "offline";

// Markdown styled to read easily while writing (replaces CodeMirror's default, where headings were underlined like
// broken links): headings bold and larger by level, the # ** > - marks faded, quotes grey, code on a light
// background.
const mdStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.3em", fontWeight: "700" },
  { tag: t.heading2, fontSize: "1.15em", fontWeight: "700" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontSize: "1.05em", fontWeight: "600" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.processingInstruction, t.contentSeparator], color: "var(--color-ink-400)" },
  { tag: t.quote, color: "var(--color-ink-600)" },
  { tag: t.link, color: "var(--color-accent-700)" },
  { tag: t.url, color: "var(--color-ink-500)" },
  { tag: t.monospace, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.92em", backgroundColor: "var(--color-ink-100)", borderRadius: "3px" },
]);

// "Live preview" writing: lines without the cursor hide their markdown marks, the line being edited shows them
// (lib/md-live.mjs).
class BulletWidget extends WidgetType {
  toDOM() { const s = document.createElement("span"); s.className = "cm-md-bullet"; s.textContent = "•"; return s; }
  eq() { return true; }
}
const HIDE = Decoration.replace({});
const BULLET = Decoration.replace({ widget: new BulletWidget() });
const QUOTE_LINE = Decoration.line({ class: "cm-md-quote" });
function liveDecorations(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const m of liveMarks(view.state, [...view.visibleRanges]) as { from: number; to: number; kind: string }[]) {
    b.add(m.from, m.to, m.kind === "bullet" ? BULLET : m.kind === "quote-line" ? QUOTE_LINE : HIDE);
  }
  return b.finish();
}
const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = liveDecorations(view); }
  update(u: ViewUpdate) {
    if (u.docChanged || u.selectionSet || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = liveDecorations(u.view);
  }
}, { decorations: (p) => p.decorations });

const theme = EditorView.theme({
  ".cm-md-quote": { borderLeft: "3px solid var(--color-ink-200)", paddingLeft: "10px !important" },
  ".cm-md-bullet": { color: "var(--color-ink-400)", padding: "0 2px" },
  "&": { fontSize: "13px", height: "100%" },
  // The app's normal font (not monospace): monospace fonts draw Vietnamese diacritics out of place.
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.65" },
  ".cm-content": { padding: "12px 0" },
  ".cm-gutters": { background: "transparent", border: "none" },
  "&.cm-focused": { outline: "none" },
});

export function SpecEditor({ docName, me, kind, onText }: {
  /** "<version>/<path>.behavior.md|.tech.md" */
  docName: string;
  me: Who;
  kind: "behavior" | "tech";
  /** The text being written (for the preview). */
  onText?: (text: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [editors, setEditors] = useState<Who[]>([]);
  const [text, setText] = useState("");
  // Checked in the project's language (its vocabulary); the issue texts in the viewer's.
  const contentLang = useProject()?.language;
  const issues = kind === "behavior" && contentLang ? behaviorIssues(text, { lang: contentLang, uiLang: lang }) : [];

  useEffect(() => {
    const c = openDoc(docName, me);
    const undoManager = new Y.UndoManager(c.text);
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: c.text.toString(),
        extensions: [basicSetup, markdown({ base: markdownLanguage }), syntaxHighlighting(mdStyle), livePreview, EditorView.lineWrapping, theme, yCollab(c.text, c.provider.awareness, { undoManager })],
      }),
    });
    const emit = () => {
      const t = c.text.toString();
      onText?.(t);
      setText(t);
    };
    c.text.observe(emit);
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
      c.text.unobserve(emit);
      c.provider.awareness?.off("change", onAware);
      view.destroy();
      undoManager.destroy();
      c.destroy();
    };
  }, [docName, me.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const label: Record<Status, string> = T.saveStatus;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 py-1.5 border-b border-ink-100 flex items-center gap-2 text-xs">
        <span className={cn("inline-flex items-center gap-1", status === "offline" ? "text-rose-700" : status === "saving" ? "text-amber-700" : "text-ink-500")}>
          <span className={cn("w-1.5 h-1.5 rounded-full", status === "offline" ? "bg-rose-500" : status === "saving" ? "bg-amber-500" : status === "saved" ? "bg-emerald-500" : "bg-ink-300")} />
          {label[status]}
        </span>
        <span data-editors={editors.length} className="ml-auto inline-flex items-center gap-1.5 text-ink-500" title={editors.map((e) => e.name).join(", ")}>
          {editors.slice(0, 5).map((e, i) => <span key={i} className="w-2.5 h-2.5 rounded-full border border-surface" style={{ background: e.color }} />)}
          {T.editors(editors.length)}
        </span>
      </div>
      <div ref={host} className="flex-1 min-h-0 overflow-hidden [&_.cm-editor]:h-full" />
      {issues.length > 0 && (
        <div className="p-2 border-t border-ink-100 max-h-32 overflow-y-auto">
          <InlineNotice tone="warning">
            <b>{T.notPlainCount(issues.length)}</b>
            <ul className="mt-1 text-xs list-disc pl-4">{issues.slice(0, 4).map((x, i) => <li key={i}>{x}</li>)}</ul>
          </InlineNotice>
        </div>
      )}
    </div>
  );
}
