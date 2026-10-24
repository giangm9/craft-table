// The e2e tests look for UI words through a hand copy of the studio's dictionaries (tests/lib/e2e.mjs UI_TEXTS).
// Each copied word must still be (part of) a text of its language's dictionaries, or an e2e test would wait for a
// word the studio no longer shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { UI_TEXTS } from "./lib/e2e.mjs";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./index" && context.parentURL?.includes("/studio/src/i18n/")) return next("./index.ts", context);
    return next(specifier, context);
  },
});
const DICTS = [
  (await import("../studio/src/i18n/shell.ts")).SHELL_TEXTS,
  (await import("../studio/src/i18n/ui.ts")).UI_TEXTS,
  (await import("../studio/src/i18n/threads.ts")).TEXTS,
  (await import("../studio/src/i18n/history.ts")).HISTORY_TEXTS,
  (await import("../studio/src/i18n/spec.ts")).SPEC_TEXTS,
  (await import("../studio/src/i18n/values.ts")).VALUE_TEXTS,
  (await import("../studio/src/i18n/agent-texts.ts")).STORED_TEXTS,
];

/** Every text of a dictionary side: strings, nested strings, and functions called with "…" for each parameter. */
function texts(d, out = []) {
  for (const v of Object.values(d)) {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") {
      try {
        const r = v(...Array.from({ length: Math.max(1, v.length) }, () => new Proxy(() => "…", { get: (_, k) => (k === Symbol.toPrimitive || k === "toString" ? () => "…" : k === "length" ? 1 : k === "join" || k === "map" ? () => "…" : "…") })));
        out.push(Array.isArray(r) ? r.filter((x) => typeof x === "string").join("") : String(r));
      } catch { /* a text that needs real params: not matched against */ }
    } else if (v && typeof v === "object") texts(v, out);
  }
  return out;
}

for (const lang of ["en", "vi"]) {
  test(`e2e words (${lang}): each is part of a text of the studio's ${lang} dictionaries`, () => {
    const all = DICTS.flatMap((d) => texts(d[lang]));
    const missing = Object.entries(UI_TEXTS[lang]).filter(([, w]) => typeof w === "string" && !all.some((t) => t.includes(w)));
    assert.deepEqual(missing, []);
  });
}
