import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LANGS, normalizeLang, requestLang, StudioError, translate, errorText, withLang } from "./i18n.mjs";

test("LANGS / normalizeLang: en and vi only", () => {
  assert.deepEqual(LANGS, ["en", "vi"]);
  assert.equal(normalizeLang("en"), "en");
  assert.equal(normalizeLang("vi"), "vi");
  for (const x of ["", "EN", "fr", "vi-VN", null, undefined, 1, {}]) assert.equal(normalizeLang(x), null);
});

test("requestLang: the ct_lang cookie wins, then the project's language, then en", () => {
  assert.equal(requestLang({ cookie: "ct_lang=vi" }, "en"), "vi");
  assert.equal(requestLang({ cookie: "ds_sess=abc; ct_lang=en" }, "vi"), "en");
  assert.equal(requestLang({ cookie: "ct_lang=fr" }, "vi"), "vi", "a bad cookie is ignored");
  assert.equal(requestLang({ cookie: "ct_lang=%E0" }, "vi"), "vi", "a malformed cookie is ignored");
  assert.equal(requestLang({}, "vi"), "vi");
  assert.equal(requestLang({}, "en"), "en");
  assert.equal(requestLang({}, "de"), "en");
  assert.equal(requestLang({}), "en");
  assert.equal(requestLang(undefined, undefined), "en");
});

const DICT = {
  en: { hello: "Hello", count: ({ n }) => `${n} items`, onlyEn: "English only" },
  vi: { hello: "Xin chào", count: ({ n }) => `${n} mục` },
};

test("translate: the language's text, functions get the params; missing → English; unknown → the code", () => {
  assert.equal(translate(DICT, "vi", "hello"), "Xin chào");
  assert.equal(translate(DICT, "en", "count", { n: 3 }), "3 items");
  assert.equal(translate(DICT, "vi", "count", { n: 3 }), "3 mục");
  assert.equal(translate(DICT, "vi", "onlyEn"), "English only");
  assert.equal(translate(DICT, "vi", "nope"), "nope");
  assert.equal(translate(DICT, "xx", "hello"), "Hello");
  assert.equal(translate(undefined, "vi", "hello"), "hello");
});

test("StudioError: code, params, status (default 400); message is the code (logs stay English-neutral)", () => {
  const e = new StudioError("badThing", { x: 1 });
  assert.ok(e instanceof Error);
  assert.equal(e.code, "badThing");
  assert.deepEqual(e.params, { x: 1 });
  assert.equal(e.status, 400);
  assert.equal(new StudioError("gone", {}, 404).status, 404);
  assert.equal(new StudioError("plain").params && typeof new StudioError("plain").params, "object");
  assert.match(e.message, /badThing/);
});

test("errorText: a StudioError is translated from the first dictionary that knows it; other errors keep their message", () => {
  const other = { en: { badThing: ({ x }) => `bad ${x}` }, vi: { badThing: ({ x }) => `hỏng ${x}` } };
  assert.equal(errorText(new StudioError("badThing", { x: 2 }), "vi", DICT, other), "hỏng 2");
  assert.equal(errorText(new StudioError("hello"), "vi", DICT, other), "Xin chào");
  assert.equal(errorText(new StudioError("unknown"), "en", DICT), "unknown");
  assert.equal(errorText(new Error("raw"), "vi", DICT), "raw");
  assert.equal(errorText("text", "vi", DICT), "text");
});

test("withLang: sets <html lang>, adds data-ui-lang when given, keeps other attributes, refuses odd values", () => {
  const src = '<!doctype html>\n<html lang="vi" data-theme="light">\n<head></head><body lang="x"></body></html>';
  assert.equal(withLang(src, { lang: "en" }), '<!doctype html>\n<html lang="en" data-theme="light">\n<head></head><body lang="x"></body></html>');
  assert.equal(withLang('<html lang="en">', { lang: "vi", uiLang: "en" }), '<html lang="vi" data-ui-lang="en">');
  assert.equal(withLang("<html>", { lang: "vi" }), '<html lang="vi">', "no lang attribute yet → added");
  assert.equal(withLang('<html lang="vi" data-ui-lang="vi">', { lang: "vi", uiLang: "en" }), '<html lang="vi" data-ui-lang="en">', "idempotent");
  assert.equal(withLang('<html lang="vi">', { lang: '"><script>' }), '<html lang="en">', "only en / vi are written");
  assert.equal(withLang("no html tag", { lang: "vi" }), "no html tag");
});

// Every server dictionary (studio/lib/i18n/<area>.mjs): same keys in en and vi, a function in one language is a
// function of the same arity in the other, no empty text.
const DIR = path.join(import.meta.dirname, "i18n");
const DICTS = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).sort();

test("server dictionaries exist for each area (server, data, agent)", () => {
  for (const f of ["server.mjs", "data.mjs", "agent.mjs"]) assert.ok(DICTS.includes(f), f);
});

for (const f of DICTS) {
  test(`parity: studio/lib/i18n/${f}`, async () => {
    const d = (await import(path.join(DIR, f))).default;
    assert.ok(d && typeof d === "object", "default export { en, vi }");
    assert.deepEqual(Object.keys(d).sort(), ["en", "vi"]);
    assert.deepEqual(Object.keys(d.vi).sort(), Object.keys(d.en).sort(), "same keys in en and vi");
    for (const k of Object.keys(d.en)) {
      for (const l of LANGS) {
        const v = d[l][k];
        assert.ok(typeof v === "string" || typeof v === "function", `${l}.${k}: string or (params) => string`);
        if (typeof v === "string") assert.ok(v.trim(), `${l}.${k}: empty`);
      }
      assert.equal(typeof d.vi[k], typeof d.en[k], `${k}: string in one language, function in the other`);
      if (typeof d.en[k] === "function") assert.equal(d.vi[k].length, d.en[k].length, `${k}: arity differs`);
    }
  });
}

test("server.mjs and data.mjs share no key (both are looked up at the server boundary)", async () => {
  const a = (await import(path.join(DIR, "server.mjs"))).default.en;
  const b = (await import(path.join(DIR, "data.mjs"))).default.en;
  assert.deepEqual(Object.keys(a).filter((k) => Object.hasOwn(b, k)), []);
});

test("one error, one wording: a bad board id reads the same from the thread lib and from the server", async () => {
  const SERVER = (await import("./i18n/server.mjs")).default;
  const DATA = (await import("./i18n/data.mjs")).default;
  for (const lang of LANGS) assert.equal(translate(SERVER, lang, "apiBadEntry"), translate(DATA, lang, "threadEntryInvalid"), lang);
});
