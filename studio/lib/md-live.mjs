// "Live preview" markdown editing (markdown symbols hidden, shown only on the line being edited): a line
// WITHOUT the cursor hides its symbols (# ** ` ~~ > and the (url) part of links), a leading "-" becomes "•"; the line
// being edited shows as it is. Code blocks / diagrams / tables stay as they are. Returns a list of ranges — the
// editor (SpecEditor) turns them into CodeMirror decorations. Pure over the CodeMirror state (runs in Node tests).
import { syntaxTree } from "@codemirror/language";

/** The lines (line numbers) holding the cursor / a selection. */
function activeLines(state) {
  const out = new Set();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number, b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return out;
}

/**
 * → [{ from, to, kind }] sorted by position: "hide" (hidden), "bullet" ("-" replaced by a dot), "quote-line" (marks a
 * quote line, from = to = start of the line). ranges: only these ranges are looked at (default: the whole document).
 */
export function liveMarks(state, ranges = [{ from: 0, to: state.doc.length }]) {
  const active = activeLines(state);
  const doc = state.doc;
  const out = [];
  const quoteLines = new Set();
  const spaceAfter = (to) => (doc.sliceString(to, to + 1) === " " ? to + 1 : to);
  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from, to,
      enter: (n) => {
        if (n.name === "FencedCode" || n.name === "CodeBlock" || n.name === "Table" || n.name === "HTMLBlock") return false;
        if (n.name === "Blockquote") {
          for (let l = doc.lineAt(n.from).number; l <= doc.lineAt(n.to).number; l++) quoteLines.add(doc.line(l).from);
        }
        if (active.has(doc.lineAt(n.from).number)) return;
        const parent = n.node.parent?.name;
        switch (n.name) {
          case "HeaderMark": if (parent?.startsWith("ATXHeading")) out.push({ from: n.from, to: spaceAfter(n.to), kind: "hide" }); break;
          case "QuoteMark": out.push({ from: n.from, to: spaceAfter(n.to), kind: "hide" }); break;
          case "EmphasisMark": case "StrikethroughMark": out.push({ from: n.from, to: n.to, kind: "hide" }); break;
          case "CodeMark": if (parent === "InlineCode") out.push({ from: n.from, to: n.to, kind: "hide" }); break;
          case "ListMark": if (n.node.parent?.parent?.name === "BulletList") out.push({ from: n.from, to: n.to, kind: "bullet" }); break;
          case "Link": {
            // [text](url) → only "text" is left: hide "[" and the whole "](…)".
            const marks = n.node.getChildren("LinkMark");
            if (n.node.getChild("URL") && marks.length >= 2) {
              out.push({ from: marks[0].from, to: marks[0].to, kind: "hide" });
              out.push({ from: marks[1].from, to: n.to, kind: "hide" });
            }
            return false;
          }
        }
      },
    });
  }
  for (const p of quoteLines) out.push({ from: p, to: p, kind: "quote-line" });
  const rank = (k) => (k === "quote-line" ? 0 : 1);
  out.sort((a, b) => a.from - b.from || rank(a.kind) - rank(b.kind));
  // Drop duplicate ranges (when the ranges looked at overlap).
  return out.filter((m, i) => i === 0 || !(m.from === out[i - 1].from && m.to === out[i - 1].to && m.kind === out[i - 1].kind));
}
