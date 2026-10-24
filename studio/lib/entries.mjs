// Board catalogue: the server scans versions/<v>/boards/**.tsx and reads `export const meta = {...}` with a small literal
// parser (NO eval) — the studio does not need to import board files, so editing a board only reloads that frame,
// not the whole studio.
// PURE file (the UI shares it through thread-core) — file reading is in meta-io.mjs.

// id = path inside boards/; an OPTION of a screen adds "~<name>" at the end (once, after the file name):
// "screens/orders/list~compact" (studio/lib/options.mjs).
const ENTRY_RE = /^[a-z0-9][a-z0-9/_-]{0,160}(?:(?<=[a-z0-9_-])~[a-z0-9][a-z0-9-]{0,40})?$/;

/** Board id = relative path inside boards/, never going up a folder. */
export function isValidEntryId(s) {
  return typeof s === "string"
    && ENTRY_RE.test(s)
    && !s.split("/").some((seg) => seg === "" || seg === "..");
}

/** "system/colors.tsx" → "system/colors"; null when it is not a board. */
export function entryIdFromPath(rel) {
  if (typeof rel !== "string" || !rel.endsWith(".tsx")) return null;
  const id = rel.slice(0, -4);
  const segs = id.split("/");
  if (segs.some((s) => s === "" || s.startsWith("_") || s === "..")) return null;
  if (!ENTRY_RE.test(id)) return null;
  return id;
}

export function extractMeta(src) {
  const m = /export\s+const\s+meta\s*=\s*/.exec(src ?? "");
  if (!m) return null;
  try {
    const p = new LiteralParser(src, m.index + m[0].length);
    const v = p.value();
    if (!v || typeof v !== "object" || Array.isArray(v) || typeof v.title !== "string") return null;
    return v;
  } catch {
    return null;
  }
}

/** Position of the `export const meta = {...};` block (with the ; and the blank lines right after) → { start, end }; none → null. */
export function metaRange(src) {
  const m = /export\s+const\s+meta\s*=\s*/.exec(src ?? "");
  if (!m) return null;
  try {
    const p = new LiteralParser(src, m.index + m[0].length);
    p.value();
    let end = p.i;
    if (src[end] === ";") end++;
    while (src[end] === "\n" || src[end] === "\r") end++;
    return { start: m.index, end };
  } catch {
    return null;
  }
}

/** Remove the meta block from a board's code (the meta moves out to <screen>.meta.json). */
export function stripMeta(src) {
  const r = metaRange(src);
  return r ? src.slice(0, r.start) + src.slice(r.end) : src;
}

// Accepts only: objects (keys are identifiers or strings), arrays, strings '..' ".." `..` (no ${}), numbers,
// true/false/null. Trailing commas and comments are allowed. Its errors never leave this file (extractMeta and
// metaRange catch them), so they are plain English.
class LiteralParser {
  constructor(s, i) { this.s = s; this.i = i; }
  ws() {
    for (;;) {
      while (/\s/.test(this.s[this.i] ?? "")) this.i++;
      if (this.s.startsWith("//", this.i)) { this.i = this.s.indexOf("\n", this.i); if (this.i < 0) this.i = this.s.length; continue; }
      if (this.s.startsWith("/*", this.i)) { const e = this.s.indexOf("*/", this.i); if (e < 0) throw new Error("comment"); this.i = e + 2; continue; }
      return;
    }
  }
  value() {
    this.ws();
    const c = this.s[this.i];
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"' || c === "'" || c === "`") return this.string();
    const num = /^-?\d+(\.\d+)?/.exec(this.s.slice(this.i, this.i + 32));
    if (num) { this.i += num[0].length; return Number(num[0]); }
    for (const [w, v] of [["true", true], ["false", false], ["null", null]]) {
      if (this.s.startsWith(w, this.i) && !/[\w$]/.test(this.s[this.i + w.length] ?? "")) { this.i += w.length; return v; }
    }
    throw new Error("not a literal");
  }
  string() {
    const q = this.s[this.i++];
    let out = "";
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === q) return out;
      if (q === "`" && c === "$" && this.s[this.i] === "{") throw new Error("template");
      if (c === "\\") {
        const n = this.s[this.i++];
        out += n === "n" ? "\n" : n === "t" ? "\t" : n;
      } else out += c;
    }
    throw new Error("unterminated string");
  }
  array() {
    this.i++;
    const out = [];
    for (;;) {
      this.ws();
      if (this.s[this.i] === "]") { this.i++; return out; }
      out.push(this.value());
      this.ws();
      if (this.s[this.i] === ",") { this.i++; continue; }
      if (this.s[this.i] === "]") { this.i++; return out; }
      throw new Error("bad array");
    }
  }
  object() {
    this.i++;
    const out = {};
    for (;;) {
      this.ws();
      if (this.s[this.i] === "}") { this.i++; return out; }
      let key;
      const c = this.s[this.i];
      if (c === '"' || c === "'") key = this.string();
      else {
        const id = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i, this.i + 64));
        if (!id) throw new Error("bad key");
        key = id[0];
        this.i += key.length;
      }
      this.ws();
      if (this.s[this.i++] !== ":") throw new Error("missing :");
      out[key] = this.value();
      this.ws();
      if (this.s[this.i] === ",") { this.i++; continue; }
      if (this.s[this.i] === "}") { this.i++; return out; }
      throw new Error("bad object");
    }
  }
}
