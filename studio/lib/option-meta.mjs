// OPTION info in the meta of screen "<screen>~<name>": option = { of: "<screen>", name, status, … }.
// Claude in the studio creates options by writing files, so it once wrote a wrong shape ("option": "a-compact")
// → the screen list lost the name, the option drifted away from its main screen, and adopting produced junk
// keys {0:'a',1:'-',…}.
//   normalizeOption — repairs on READ / ADOPT / RENAME (of always follows the id; the name comes from the title if missing)
//   optionMetaIssue — blocks when Claude WRITES (write/edit tools), answering with the correct shape
// Pure (shared by the server and the UI). optionMetaIssue's text is for Claude: it follows the { lang } it is given
// (the project's), texts in lib/i18n/data.mjs.
import { optionStatusCode } from "./legacy-values.mjs";
import { dataText } from "./i18n/data.mjs";

// Stored as neutral codes (labels: studio/src/i18n/values.ts); options written by earlier versions hold Vietnamese
// words, read through optionStatusCode.
export const OPTION_STATUSES = ["trying", "adopted"];

/** "Today · A. Compact rows" → "A. Compact rows" (the part after the last " · "); none → null. */
function nameFromTitle(title) {
  const parts = String(title ?? "").split(" · ");
  return parts.length > 1 ? parts.at(-1).trim() || null : null;
}

/** Meta with a normalized option field (a screen that is not an option → the meta as it is). */
export function normalizeOption(id, meta) {
  const s = String(id ?? "");
  if (!s.includes("~") || !meta) return meta;
  const [base, slug] = s.split("~");
  const o = meta.option;
  const obj = o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => !/^\d+$/.test(k))) : {};
  const name = (typeof obj.name === "string" && obj.name.trim()) || nameFromTitle(meta.title) || (typeof o === "string" && o.trim()) || slug;
  const code = optionStatusCode(obj.status);
  const status = OPTION_STATUSES.includes(code) ? code : "trying";
  const option = { ...obj, of: base, name, status };
  if (o && typeof o === "object" && JSON.stringify(o) === JSON.stringify(option)) return meta;
  return { ...meta, option };
}

/**
 * Is the content of an option's info file (boards/<screen>~<name>.meta.json) in the right shape? → null, or what is
 * wrong (with the correct shape), in `lang` ("en" | "vi", default "en": the project's language — Claude reads it).
 * @param {string} rel @param {string} content @param {{ lang?: string }} [opts]
 */
export function optionMetaIssue(rel, content, opts = {}) {
  const m = /^boards\/(.+~[^/]+)\.meta\.json$/.exec(String(rel ?? ""));
  if (!m) return null;
  const base = m[1].split("~")[0];
  const say = (key) => dataText(opts?.lang ?? "en", key, { base });
  let j;
  try { j = JSON.parse(content); } catch { return say("optionMetaNotJson"); }
  const o = j?.option;
  if (!o || typeof o !== "object" || Array.isArray(o)) return say("optionMetaNotObject");
  if (o.of !== base) return say("optionMetaBadOf");
  if (typeof o.name !== "string" || !o.name.trim()) return say("optionMetaBadName");
  // An old word (the Vietnamese "trying" / "adopted" of earlier versions) is accepted — normalizeOption reads it as its code.
  if (!OPTION_STATUSES.includes(optionStatusCode(o.status))) return say("optionMetaBadStatus");
  return null;
}
