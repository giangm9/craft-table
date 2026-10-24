// The studio UI speaks English and Vietnamese. The viewer's language comes from the page:
// the server writes <html lang> (studio pages) or data-ui-lang (a board's frame, whose lang is the project's)
// from the ct_lang cookie, else the project's language, else English (studio/lib/i18n.mjs). Switching language
// writes the cookie and reloads the page (setLang), so `lang` is fixed for the life of a page.
//
// One dictionary per area, next to this file; TypeScript keeps the two languages in step (`vi: typeof en`):
//
//   // studio/src/i18n/threads.ts
//   const en = { send: "Send", replies: (n: number) => `${n} replies` };
//   const vi: typeof en = { send: "Gửi", replies: (n) => `${n} tin` };
//   export const T = pick({ en, vi });
//
// and in a component:  import { T } from "./i18n/threads"; … <button>{T.send}</button> … {T.replies(3)}
//
// Never build a sentence from translated fragments: a text that needs values is one function with params, so word
// order can differ per language. Labels of stored codes (statuses, authors, devices) are in values.ts; texts the
// studio stores in data as { key, params } are rendered by agent-status.ts. No imports here (node tests load it).

export type Lang = "en" | "vi";

/** Language of a page's root element: data-ui-lang (a board's frame) wins over lang; "vi" → vi, anything else → en. */
export function langFrom(root: { lang?: string; dataset?: { uiLang?: string } } | undefined): Lang {
  const raw = root?.dataset?.uiLang ?? root?.lang;
  return raw === "vi" ? "vi" : "en";
}

export const lang: Lang = langFrom(typeof document === "undefined" ? undefined : document.documentElement);
/** Locale for dates and numbers (toLocaleDateString, Intl…). */
export const locale = lang === "vi" ? "vi-VN" : "en-US";

/** This page's language out of a { en, vi } pair. */
export function pick<T>(d: { en: T; vi: T }): T {
  return d[lang];
}

/** Switch the viewer's language: a cookie for a year (read by the server, every page), then reload. */
export function setLang(l: Lang) {
  document.cookie = `ct_lang=${l}; Path=/; Max-Age=31536000; SameSite=Lax`;
  location.reload();
}
