// Joins lines HARD-WRAPPED mid-sentence in markdown (specs written by hand / Claude wrapping at ~120 characters) →
// each paragraph, list item and quote sits on ONE line; the editor wraps to its width (otherwise lines break
// raggedly when the editor is narrow). Only joins what markdown already treats as one paragraph → the rendered page does not change
// Left alone: code/diagram blocks, tables, headings, rules,
// HTML, nested lists, new items, deliberate line breaks (2 spaces or \ at the end of a line). Pure file.
const FENCE = /^\s*(```|~~~)/;
const isBlank = (s) => !s.trim();
const isHeading = (s) => /^\s{0,3}#{1,6}(\s|$)/.test(s);
const isListStart = (s) => /^\s*([-*+]|\d+[.)])\s+/.test(s);
const isTable = (s) => /^\s*\|/.test(s);
const isHr = (s) => /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(s);
const isSetext = (s) => /^\s{0,3}(=+|-+)\s*$/.test(s);
const isHtml = (s) => /^\s{0,3}</.test(s);
const hardBreak = (s) => / {2,}$/.test(s) || /\\$/.test(s);
/** The text after the ">" of a quote line; not a quote line → undefined. */
const quoteBody = (s) => /^\s{0,3}>\s?(.*)$/.exec(s)?.[1];
/** A line that cannot continue the previous paragraph (it starts a new block). */
const startsBlock = (s) => isHeading(s) || isListStart(s) || isTable(s) || isHr(s) || isSetext(s) || FENCE.test(s) || isHtml(s);

/** The text to join onto the previous line, or null when it cannot be joined. */
function continuation(prev, line) {
  if (isBlank(prev) || isBlank(line)) return null;
  if (isHeading(prev) || isTable(prev) || isHr(prev) || FENCE.test(prev) || isHtml(prev) || hardBreak(prev)) return null;
  const pq = quoteBody(prev), lq = quoteBody(line);
  if (lq !== undefined) {
    // Quotes: only a quote line onto a quote line, plain text onto plain text (no items/headings inside a quote are joined).
    if (pq === undefined || isBlank(pq) || isBlank(lq) || startsBlock(lq) || startsBlock(pq.trimStart()) || quoteBody(lq) !== undefined) return null;
    return lq.trim();
  }
  if (pq !== undefined) return null; // plain text after a quote: left as is (markdown "laziness", not worth the risk)
  if (startsBlock(line)) return null;
  return line.trim();
}

export function unwrapMarkdown(text) {
  const out = [];
  let inFence = false;
  for (const line of String(text).split("\n")) {
    if (FENCE.test(line)) { inFence = !inFence; out.push(line); continue; }
    if (inFence) { out.push(line); continue; }
    const prev = out.length ? out[out.length - 1] : null;
    const c = prev == null ? null : continuation(prev, line);
    if (c != null && c !== "") { out[out.length - 1] = `${prev.replace(/\s+$/, "")} ${c}`; continue; }
    out.push(line);
  }
  return out.join("\n");
}
