// The studio speaks English and Vietnamese.
//   • Viewer language — everything a person reads in the studio and every message the server sends them: the
//     ct_lang cookie when it is set (the UI's language switch writes it), else the project's craft-table.json
//     "language", else "en" (requestLang).
//   • Claude's language — system prompt, tool texts, rules, the per-turn prompt: the PROJECT language
//     (lib/i18n/agent.mjs). Claude answers in the language the person wrote in.
//   • CLI output and console logs: English only, no dictionary.
// Server dictionaries: one module per area, lib/i18n/<area>.mjs, `export default { en: {...}, vi: {...} }`; a value
// is a string or (params) => string, so word order can differ per language (never join translated fragments).
// i18n.test.mjs checks that every dictionary has the same keys, kinds and arities in both languages.
// A lib error that reaches a viewer is a StudioError (code + params); the server boundary translates it
// (errorText) in the viewer's language.
import { parseCookies } from "./session.mjs";

export const LANGS = ["en", "vi"];
export const LANG_COOKIE = "ct_lang";

/** "en" | "vi", or null for anything else. */
export const normalizeLang = (x) => (LANGS.includes(x) ? x : null);

/** Viewer language of a request: cookie ct_lang (when valid) → the project's language (when valid) → "en". */
export function requestLang(headers, projectLanguage) {
  const fromCookie = normalizeLang(parseCookies(headers?.cookie)[LANG_COOKIE]);
  return fromCookie ?? normalizeLang(projectLanguage) ?? "en";
}

/** An error meant for a viewer: translated where it leaves the server (errorText), never shown as a raw code. */
export class StudioError extends Error {
  constructor(code, params = {}, status = 400) {
    super(Object.keys(params ?? {}).length ? `${code} ${JSON.stringify(params)}` : code);
    this.name = "StudioError";
    this.code = code;
    this.params = params ?? {};
    this.status = status;
  }
}

/** Text of `code` in `lang`: that language → English → the code itself (a missing text never breaks a page). */
export function translate(dict, lang, code, params = {}) {
  const v = dict?.[lang]?.[code] ?? dict?.en?.[code];
  if (v === undefined) return code;
  return typeof v === "function" ? v(params ?? {}) : v;
}

/**
 * Message of an error for a viewer: a StudioError is looked up in the first dictionary that has its code; any other
 * error (Node, the SDK, free text) keeps its own message.
 */
export function errorText(e, lang, ...dicts) {
  if (e instanceof StudioError) {
    const d = dicts.find((x) => x?.en && Object.hasOwn(x.en, e.code));
    return translate(d, lang, e.code, e.params);
  }
  return String(e?.message ?? e);
}

/**
 * Language of a studio HTML page: <html lang="…"> (and data-ui-lang="…" when given). Studio pages get the viewer's
 * language as lang; a board's frame keeps the PROJECT language as lang (it is the board's content) and carries the
 * viewer's language in data-ui-lang for the studio's own texts drawn in it. Values other than en/vi become "en".
 */
export function withLang(html, { lang, uiLang } = {}) {
  const l = normalizeLang(lang) ?? "en";
  const ui = uiLang === undefined ? null : normalizeLang(uiLang) ?? "en";
  return String(html).replace(/<html\b([^>]*)>/i, (_, attrs) => {
    let a = attrs.replace(/\s+data-ui-lang="[^"]*"/i, "");
    a = /\slang="[^"]*"/i.test(a) ? a.replace(/\slang="[^"]*"/i, ` lang="${l}"`) : ` lang="${l}"${a}`;
    if (ui) a = a.replace(/\slang="[^"]*"/i, (m) => `${m} data-ui-lang="${ui}"`);
    return `<html${a}>`;
  });
}
