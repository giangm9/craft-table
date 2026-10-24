import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { liveMarks } from "./md-live.mjs";

const DOC = "# Tiêu đề\n\n- **Ai**: x `code` ~~gạch~~\n1. một\n> trích dẫn\n\nXem [trang](https://example.com).\n```\n**k** `c`\n```";
function state(cursor) {
  const s0 = EditorState.create({ doc: DOC, selection: EditorSelection.cursor(cursor), extensions: [markdown({ base: markdownLanguage })] });
  // A new state parses for only ~20 ms (on a busy machine: the first line or so). ensureSyntaxTree finishes the
  // parse but does not put the tree in this state — the next transaction does, as in the editor.
  ensureSyntaxTree(s0, s0.doc.length, 5000);
  const s = s0.update({}).state;
  assert.equal(syntaxTree(s).length, s.doc.length, "the whole document is parsed");
  return s;
}
const hidden = (s) => liveMarks(s).filter((m) => m.kind === "hide").map((m) => s.doc.sliceString(m.from, m.to));
const lineStart = (n) => DOC.split("\n").slice(0, n - 1).join("\n").length + (n > 1 ? 1 : 0);

test("lines without the cursor: hide # ** ` ~~ > and the link's URL part; '-' becomes a bullet; list numbers stay", () => {
  const s = state(lineStart(2)); // cursor on the empty line
  assert.deepEqual(hidden(s), ["# ", "**", "**", "`", "`", "~~", "~~", "> ", "[", "](https://example.com)"]);
  const bullets = liveMarks(s).filter((m) => m.kind === "bullet").map((m) => s.doc.sliceString(m.from, m.to));
  assert.deepEqual(bullets, ["-"]);
  assert.equal(liveMarks(s).filter((m) => m.kind === "quote-line").length, 1, "the quote line has a left border");
});

test("the line with the cursor (being edited) shows its symbols as typed; code blocks keep every character", () => {
  const onHeading = hidden(state(3));
  assert.ok(!onHeading.includes("# "), "heading line being edited → # shown");
  assert.ok(onHeading.includes("**"), "other lines stay hidden");
  const onList = hidden(state(lineStart(3) + 4));
  assert.ok(!onList.includes("**") && !onList.includes("`") && onList.includes("# "));
  // Nothing is hidden inside a code block (including ``` and ** inside it).
  assert.ok(!hidden(state(0)).some((x) => x === "```"));
});

test("liveMarks are sorted by position and never overlap (CodeMirror requires the order)", () => {
  const ms = liveMarks(state(lineStart(2)));
  for (let i = 1; i < ms.length; i++) {
    assert.ok(ms[i].from >= ms[i - 1].from, `order ${i}`);
    if (ms[i].kind !== "quote-line" && ms[i - 1].kind !== "quote-line") assert.ok(ms[i].from >= ms[i - 1].to, `overlap ${i}`);
  }
});
