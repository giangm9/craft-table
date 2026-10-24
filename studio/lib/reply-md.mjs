// Claude's reply (markdown) → a PLAIN tree of blocks/inlines that React turns straight into elements — NO HTML is
// injected: Claude can be tricked (images, files in a board) into returning <script>, javascript: links, outside
// images. HTML shows as text, links are http(s) only, images are not loaded. [#n] (a mark) becomes a { t: "ref", k } node.
//   blocks:  p · h · ul/ol (items: block[][]) · quote · pre · hr · table
//   inlines: text · ref · b · i · del · code · a · br
import { marked } from "marked";

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const unesc = (s) => String(s ?? "").replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENT[m]);
const safeHref = (h) => (/^https?:\/\//i.test(String(h ?? "")) ? h : null);

/** Text → text + ref nodes at each [#n]. */
function withRefs(s) {
  const out = [];
  for (const part of String(s).split(/(\[#\d+\])/g)) {
    if (!part) continue;
    const m = /^\[#(\d+)\]$/.exec(part);
    out.push(m ? { t: "ref", k: Number(m[1]) } : { t: "text", v: part });
  }
  return out;
}

function inline(tokens = []) {
  const out = [];
  for (const t of tokens) {
    switch (t.type) {
      case "text":
      case "escape":
        out.push(...(t.tokens?.length ? inline(t.tokens) : withRefs(unesc(t.text))));
        break;
      case "strong": out.push({ t: "b", c: inline(t.tokens) }); break;
      case "em": out.push({ t: "i", c: inline(t.tokens) }); break;
      case "del": out.push({ t: "del", c: inline(t.tokens) }); break;
      case "codespan": out.push({ t: "code", v: unesc(t.text) }); break;
      case "br": out.push({ t: "br" }); break;
      case "link": {
        const href = safeHref(t.href);
        if (href) out.push({ t: "a", href, c: inline(t.tokens) });
        else out.push(...inline(t.tokens));
        break;
      }
      case "image": if (t.text) out.push(...withRefs(unesc(t.text))); break; // outside images are never loaded
      case "html": out.push(...withRefs(t.text)); break; // HTML → text
      default: if (t.text) out.push(...withRefs(unesc(t.text)));
    }
  }
  return out;
}

function blocks(tokens = []) {
  const out = [];
  for (const t of tokens) {
    switch (t.type) {
      case "space": break;
      case "paragraph": out.push({ t: "p", c: inline(t.tokens) }); break;
      case "text": out.push({ t: "p", c: inline(t.tokens?.length ? t.tokens : [t]) }); break; // text inside a list item
      case "heading": out.push({ t: "h", c: inline(t.tokens) }); break;
      case "list": out.push(t.ordered ? { t: "ol", start: Number(t.start) || 1, items: t.items.map((i) => blocks(i.tokens)) } : { t: "ul", items: t.items.map((i) => blocks(i.tokens)) }); break;
      case "blockquote": out.push({ t: "quote", c: blocks(t.tokens) }); break;
      case "code": out.push({ t: "pre", v: String(t.text ?? "") }); break;
      case "hr": out.push({ t: "hr" }); break;
      case "table": out.push({ t: "table", head: t.header.map((h) => inline(h.tokens)), rows: t.rows.map((r) => r.map((c) => inline(c.tokens))) }); break;
      case "html": { const s = String(t.text).trim(); if (s) out.push({ t: "p", c: withRefs(s) }); break; } // HTML → text
      default: if (t.text) out.push({ t: "p", c: withRefs(unesc(t.text)) });
    }
  }
  return out;
}

/** Markdown → block tree (a single line break inside a paragraph is a real line break, as Claude writes it). */
export function replyBlocks(md) {
  return blocks(marked.lexer(String(md ?? ""), { gfm: true, breaks: true }));
}

/** Plain one-line text (the preview in the thread list): markdown symbols dropped, [#n] kept. */
export function replyPlain(md) {
  const words = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.t === "text" || n.t === "code" || n.t === "pre") words.push(n.v);
    else if (n.t === "ref") words.push(`[#${n.k}]`);
    else if (n.t === "br") words.push(" ");
    if (n.c) walk(n.c);
    if (n.items) n.items.forEach(walk);
    if (n.head) n.head.forEach(walk);
    if (n.rows) n.rows.forEach((r) => r.forEach(walk));
    if (n.t === "p" || n.t === "h") words.push(" ");
  };
  walk(replyBlocks(md));
  return words.join("").replace(/\s+/g, " ").trim();
}
