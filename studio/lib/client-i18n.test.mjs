// The studio UI's own i18n (studio/src/i18n/): language picking, and the texts the studio stores in data as
// { key, params } (agent progress / errors, history notes). Node imports these .ts files directly (type stripping):
// they have no imports of their own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { langFrom } from "../src/i18n/index.ts";
import { STORED_TEXTS, renderStored } from "../src/i18n/agent-texts.ts";

test("langFrom: data-ui-lang (a board's frame) wins over lang; vi → vi, anything else → en", () => {
  assert.equal(langFrom({ lang: "vi", dataset: {} }), "vi");
  assert.equal(langFrom({ lang: "en", dataset: {} }), "en");
  assert.equal(langFrom({ lang: "vi", dataset: { uiLang: "en" } }), "en", "frame of a Vietnamese project viewed in English");
  assert.equal(langFrom({ lang: "en", dataset: { uiLang: "vi" } }), "vi");
  for (const l of ["", "fr", "vi-VN", undefined]) assert.equal(langFrom({ lang: l, dataset: {} }), "en", String(l));
  assert.equal(langFrom(undefined), "en");
});

test("stored texts: same keys in en and vi, same kind and arity, no empty text", () => {
  const { en, vi } = STORED_TEXTS;
  assert.deepEqual(Object.keys(vi).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en)) {
    assert.equal(typeof vi[k], typeof en[k], k);
    if (typeof en[k] === "function") assert.equal(vi[k].length, en[k].length, k);
    else assert.ok(en[k].trim() && vi[k].trim(), k);
  }
});

test("renderStored: a string is shown as it is (free text, and threads written before codes); unknown key → the key", () => {
  const vi = STORED_TEXTS.vi;
  assert.equal(renderStored(vi, "Đang sửa bản vẽ…"), "Đang sửa bản vẽ…");
  assert.equal(renderStored(vi, ""), "");
  assert.equal(renderStored(vi, null), null);
  assert.equal(renderStored(vi, undefined), null);
  assert.equal(renderStored(vi, { key: "somethingNew" }), "somethingNew");
  assert.equal(renderStored(vi, { key: "editing" }), "Đang sửa ", "missing params render as empty, never crash");
});

// The Vietnamese texts are exactly the ones the studio wrote before (projects' tests and people read them).
const VI = [
  [{ key: "listing", params: { what: "screens" } }, "Đang xem danh sách screens"],
  [{ key: "listing", params: { what: "" } }, "Đang xem danh sách"],
  [{ key: "reading", params: { path: "src:src/x.ts" } }, "Đang đọc src:src/x.ts"],
  [{ key: "searching", params: { pattern: "Lưu" } }, 'Đang tìm "Lưu"'],
  [{ key: "readingThread" }, "Đang đọc lại luồng"],
  [{ key: "viewingFrame", params: { entry: "screens/orders/today", scenario: "da-giao", viewport: "mobile" } }, "Đang xem khung screens/orders/today · da-giao · mobile"],
  [{ key: "viewingFrame", params: { entry: "screens/a", scenario: "", viewport: "desktop" } }, "Đang xem khung screens/a · desktop"],
  [{ key: "viewingMark", params: { n: 2 } }, "Đang xem vùng khoanh #2"],
  [{ key: "viewingImage" }, "Đang xem ảnh đính kèm"],
  [{ key: "locating", params: { text: "Lưu" } }, 'Đang tìm vị trí "Lưu"'],
  [{ key: "editing", params: { path: "boards/screens/a.tsx" } }, "Đang sửa boards/screens/a.tsx"],
  [{ key: "checking", params: { what: "typecheck" } }, "Đang kiểm: typecheck"],
  [{ key: "readingRules", params: { topic: "khoanh" } }, "Đang đọc luật khoanh"],
  [{ key: "usingTool", params: { name: "Other" } }, "Đang dùng Other"],
  [{ key: "queued" }, "Chờ Claude xong luồng khác trên màn này"],
  [{ key: "readingConversation" }, "Đang đọc hội thoại…"],
  [{ key: "restarted" }, "Xưởng khởi động lại giữa lượt — bấm Chạy lại."],
  [{ key: "timedOut", params: { minutes: 15 } }, "quá 15 phút"],
  [{ key: "stoppedTimedOut", params: { minutes: 15 } }, "dừng (quá 15 phút)"],
  [{ key: "userStopped" }, "người dùng bấm Dừng"],
  [{ key: "stoppedByUser" }, "dừng (người dùng bấm Dừng)"],
  [{ key: "sandboxLeak", params: { tools: "Bash, Read" } }, "sandbox hở — có công cụ ngoài xưởng: Bash, Read"],
  [{ key: "stoppedSandboxLeak", params: { tools: "Bash" } }, "dừng (sandbox hở — có công cụ ngoài xưởng: Bash)"],
  [{ key: "loginLost", params: { command: "npx craft-table login" } }, "Claude trong xưởng mất đăng nhập. Người quản trị xưởng nạp lại bằng lệnh: npx craft-table login"],
  [{ key: "noResult" }, "không có kết quả"],
  [{ key: "restoredSnapshot", params: { id: 12, ts: "2026-10-24T10:00:00.000Z" } }, "khôi phục mốc #12 (2026-10-24T10:00:00.000Z)"],
  [{ key: "adoptedOption", params: { name: "Ba nút" } }, 'chốt phương án "Ba nút"'],
  [{ key: "changedWhileOff" }, "đổi khi xưởng tắt"],
];

test("renderStored (vi): exactly the texts the studio wrote in earlier versions", () => {
  for (const [x, want] of VI) assert.equal(renderStored(STORED_TEXTS.vi, x), want, x.key);
  assert.deepEqual(Object.keys(STORED_TEXTS.vi).sort(), [...new Set(VI.map(([x]) => x.key))].sort(), "every key has a case above");
});

test("renderStored (en): every key renders English with its params", () => {
  for (const [x] of VI) {
    const s = renderStored(STORED_TEXTS.en, x);
    assert.ok(s && s !== x.key, x.key);
    const values = Object.values(x.params ?? {}).filter((v) => v !== "").map(String);
    for (const v of values) assert.ok(s.includes(v), `${x.key} shows ${v}`);
    const words = values.reduce((t, v) => t.replaceAll(v, ""), s);
    assert.doesNotMatch(words, /[àáảãạăâđèéẻẽẹêìíỉĩịòóỏõọôơùúủũụưỳýỷỹỵ]/i, `${x.key}: ${s}`);
  }
});
