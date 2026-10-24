// Texts of the spec panel, the /spec page, the spec and code editors and the screen info form
// (studio/src/i18n/spec.ts): both languages in step, the Vietnamese texts exactly as the studio showed them in
// earlier versions (projects' own tests may match them), English with no Vietnamese. (The title of a spec's intro page is
// specPages' own, tested in spec-core.test.mjs.) spec.ts imports "./index" without an extension (as the bundler
// resolves it), so a resolve hook adds ".ts" to extensionless relative imports made from .ts files before spec.ts is
// loaded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { VIETNAMESE } from "./i18n-gate.mjs";

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
});
const { SPEC_TEXTS } = await import("../src/i18n/spec.ts");

/** Sample arguments for a text function: the link builder for srcMore, a number for everything else. */
const sample = (key, f) => (key === "srcMore" ? [(s) => `[${s}]`] : Array.from({ length: f.length }, () => 7));

/** [path, value] of every leaf (string or function) of a dictionary, nested objects flattened. */
function leaves(d, at = []) {
  return Object.entries(d).flatMap(([k, v]) => (v && typeof v === "object" ? leaves(v, [...at, k]) : [[[...at, k].join("."), v, k]]));
}

test("spec texts: same keys in en and vi, same kind and arity, no empty text", () => {
  const en = leaves(SPEC_TEXTS.en), vi = new Map(leaves(SPEC_TEXTS.vi).map(([p, v]) => [p, v]));
  assert.deepEqual([...vi.keys()].sort(), en.map(([p]) => p).sort());
  for (const [p, v, k] of en) {
    const w = vi.get(p);
    assert.equal(typeof w, typeof v, p);
    if (typeof v === "function") {
      assert.equal(w.length, v.length, `${p}: arity`);
      assert.ok(String(v(...sample(k, v))).trim() && String(w(...sample(k, w))).trim(), p);
    } else assert.ok(v.trim() && w.trim(), p);
  }
});

test("spec texts (en): English only, plural counts agree with the number", () => {
  for (const [p, v, k] of leaves(SPEC_TEXTS.en)) {
    const s = typeof v === "function" ? String(v(...sample(k, v))) : v;
    assert.doesNotMatch(s, VIETNAMESE, `${p}: ${s}`);
  }
  const en = SPEC_TEXTS.en;
  assert.equal(en.editors(1), "1 person editing");
  assert.equal(en.editors(3), "3 people editing");
  assert.equal(en.notPlainCount(1), "1 place is not plain language yet");
  assert.equal(en.notPlainCount(4), "4 places are not plain language yet");
  assert.equal(en.errorAt(12), "Error on line 12:");
  assert.equal(en.errorAt(null), "Error:");
});

// Exactly what the studio showed in earlier versions.
const VI = [
  ["behavior", "Hành vi"],
  ["tech", "Kỹ thuật"],
  ["spec", "Đặc tả"],
  ["loading", "Đang tải…"],
  ["tabEmpty", "Tab này chưa có nội dung."],
  ["noContent", "Chưa có nội dung."],
  ["claudeBusy", "Claude đang sửa màn này"],
  ["screenInfo", "Thông tin màn"],
  ["connectedAutosave", "Đã nối · tự lưu"],
  ["addScenario", "Thêm kịch bản"],
  ["openSpec", "Mở đặc tả"],
  ["collapseSpec", "Thu gọn đặc tả"],
  ["collapse", "Thu gọn"],
  ["openSeparately", "Mở riêng"],
  ["toc", "Mục lục"],
  ["drawingDiagram", "Đang vẽ sơ đồ…"],
  ["openWholeFile", "Mở cả file ↗"],
];
const VI_FN = [
  ["editors", [3], "3 người đang sửa"],
  ["tabMissing", ["Hành vi"], "Hành vi (chưa có)"],
  ["scenarios", [2], "Kịch bản (2)"],
  ["scenarioId", ["scenario-1"], "Mã: scenario-1"],
  ["scenarioIdUnnamed", ["scenario-1"], "Mã: scenario-1 — đặt tên rồi bấm"],
  ["notPlain", ["a · b"], "Chưa phải lời thường: a · b"],
  ["notPlainCount", [2], "2 chỗ chưa phải lời thường"],
  ["errorAt", [12], "Lỗi dòng 12:"],
  ["errorAt", [null], "Lỗi:"],
  ["srcRefTitle", ["src/a.ts:3"], "src/a.ts:3 — bấm để xem code tại chỗ, Ctrl+bấm để mở trang"],
  ["ruleTitle", ["R5"], "Xem R5 ở tab bên kia"],
  ["srcBadFence", ["x.ts"], "Không nhúng được code: “x.ts”"],
  ["srcLoading", ["a.ts:1–3"], "Đang tải a.ts:1–3…"],
  ["srcReadFailed", ["a.ts", 404], "Không đọc được a.ts (404)"],
  ["srcMore", [(s) => `<a>${s}</a>`], "… còn tiếp — <a>xem đầy đủ</a>"],
  ["diagramError", ["Parse error"], "Sơ đồ lỗi cú pháp: Parse error"],
  ["docTitle", ["Hôm nay", "Kỹ thuật"], "Hôm nay · Kỹ thuật"],
  ["specHeader", [""], "Đặc tả"],
  ["specHeader", ["Dự án"], "Đặc tả · Dự án"],
];

test("spec texts (vi): exactly the texts the studio showed in earlier versions", () => {
  const vi = SPEC_TEXTS.vi;
  for (const [k, want] of VI) assert.equal(vi[k], want, k);
  for (const [k, args, want] of VI_FN) assert.equal(vi[k](...args), want, `${k}(${args.join(", ")})`);
  assert.deepEqual(vi.saveStatus, { connecting: "Đang nối…", saved: "Đã lưu", saving: "Đang lưu…", offline: "Mất kết nối — chưa lưu" });
});
