// Texts of history, versions and options (studio/src/i18n/history.ts: HistoryPanel, VersionsPage, OptionsUi).
// The Vietnamese side is exactly what the studio showed in earlier versions (projects' own tests may match these
// strings); the English side has no Vietnamese; both sides have the same keys, kinds and arity.
// history.ts imports "./index" without an extension (Vite style): a resolve hook maps it to index.ts so Node can load
// the .ts files directly (type stripping). Under Node there is no document, so T is the English side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { VIETNAMESE } from "./i18n-gate.mjs";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./index" && context.parentURL?.endsWith("/src/i18n/history.ts")) return next("./index.ts", context);
    return next(specifier, context);
  },
});
const { HISTORY_TEXTS, T } = await import("../src/i18n/history.ts");

/** Rich texts are arrays of strings and the nodes passed in; markers stand in for the nodes. */
const flat = (x) => (Array.isArray(x) ? x.join("") : x);

/** Every text of one language, rendered with fixed ASCII params → { "key[.sub][#case]": string }. */
function sample(t) {
  const s = {};
  for (const [k, v] of Object.entries(t)) {
    if (k.endsWith("Format")) continue; // date options, not texts (tested on their own below)
    if (typeof v === "string") s[k] = v;
    else if (typeof v === "object") for (const [k2, v2] of Object.entries(v)) s[`${k}.${k2}`] = v2;
  }
  Object.assign(s, {
    "claudeInThread#title": t.claudeInThread("Buttons"),
    "claudeInThread#none": t.claudeInThread(null),
    unchangedLines: t.unchangedLines(12),
    openSnapshotFailed: t.openSnapshotFailed(404),
    snapshotHeading: t.snapshotHeading({ file: "[F]", day: "[D]", time: "[T]" }),
    restoreLegend: flat(t.restoreLegend((x) => `[+${x}]`, (x) => `[-${x}]`)),
    restoreTitle: t.restoreTitle({ file: "[F]", day: "[D]", time: "[T]" }),
    restoreFailed: t.restoreFailed(500),
    created: t.created("[D]"),
    copiedFrom: t.copiedFrom("Main"),
    "changedScreens#1": t.changedScreens(1),
    "changedScreens#3": t.changedScreens(3),
    statusOf: t.statusOf("Main"),
    editVersion: t.editVersion("Main"),
    newVersionFrom: t.newVersionFrom("Main"),
    setLiveTitle: t.setLiveTitle("Main"),
    thisScreen: t.thisScreen("Today"),
    quoted: t.quoted("Dark"),
    optionBar: flat(t.optionBar({ name: "[N]", rename: "[R]", main: "[M]", status: "[S]" })),
    adoptBody: flat(t.adoptBody("[M]")),
    removeBody: flat(t.removeBody("[M]")),
  });
  return s;
}

// What the studio showed in earlier versions, word for word (HistoryPanel, VersionsPage, OptionsUi).
const VI = {
  "file.behavior": "Hành vi",
  "file.tech": "Kỹ thuật",
  "file.meta": "Thông tin",
  "file.board": "Bản vẽ",
  "badge.restore": "khôi phục",
  "badge.option": "chốt phương án",
  "badge.init": "khởi tạo",
  "claudeInThread#title": "Claude · Buttons",
  "claudeInThread#none": "Claude · luồng",
  localClaude: "Claude (máy chủ)",
  sameAsCurrent: "Giống hệt nội dung hiện tại.",
  unchangedLines: "… 12 dòng không đổi",
  openSnapshotFailed: "Không mở được mốc (404)",
  backToHistory: "Lịch sử",
  restore: "Khôi phục",
  loadSnapshot: "mốc này",
  loadHistory: "lịch sử",
  loading: "Đang tải…",
  snapshotHeading: "[F] · [D] [T]",
  restoreLegend: "Khôi phục: [+xanh] có lại, [-đỏ] mất.",
  restored: "Đã khôi phục — thành một mốc mới trong lịch sử.",
  fileGone: "File này hiện không còn — khôi phục sẽ tạo lại.",
  restoreTitle: "Khôi phục [F] về lúc [T] [D]?",
  restoreConfirm: "Khôi phục bản này",
  restoreFailed: "Khôi phục hỏng (500)",
  restoreKeepsCurrent: "Nội dung hiện tại không mất: nó vẫn nằm trong lịch sử, khôi phục ngược lại được.",
  noSnapshots: "Chưa có mốc nào.",
  backToStudio: "Về xưởng",
  versionsTitle: "Phiên bản",
  versionsIntro:
    "Mỗi phiên bản là một bản sao đầy đủ của cả app trong xưởng (bản vẽ, đặc tả, design system). Thiết kế bản mới không làm đổi bản đang chạy; thay đổi nhỏ trong một bản được ghi ở Lịch sử của từng màn.",
  loadVersions: "danh sách phiên bản",
  live: "Đang chạy",
  created: "Tạo [D]",
  copiedFrom: "chép từ Main",
  original: "bản gốc",
  "changedScreens#1": "1 màn đã đổi",
  "changedScreens#3": "3 màn đã đổi",
  statusOf: "Trạng thái Main",
  open: "Mở",
  editVersion: "Sửa Main",
  newFromHere: "Tạo bản mới từ đây",
  setLive: "Đặt đang chạy",
  newVersionFrom: "Tạo phiên bản mới từ Main",
  cancel: "Huỷ",
  saving: "Đang lưu…",
  createCopy: "Tạo bản sao",
  save: "Lưu",
  versionName: "Tên phiên bản",
  note: "Ghi chú",
  setLiveTitle: "Đặt Main là bản đang chạy?",
  setLiveBody: "Chỉ làm khi bản này đã được làm vào app thật. Xưởng sẽ mở bản này mặc định; bản cũ vẫn giữ nguyên để xem lại.",
  createOption: "Tạo phương án",
  create: "Tạo",
  optionName: "Tên phương án",
  optionScreens: "Màn trong phương án",
  thisScreen: "Today (màn đang xem)",
  renameOption: "Đổi tên phương án",
  quoted: "“Dark”",
  optionBar: "Phương án [N][R]của màn [M] · [S]",
  removeOption: "Bỏ phương án",
  adoptAgain: "Chốt lại",
  adoptThis: "Chốt phương án này",
  adoptTitle: "Chốt phương án?",
  adopt: "Chốt",
  adoptBody: "Chép đè lên màn [M]. Bản cũ vẫn khôi phục được ở tab Lịch sử.",
  removeTitle: "Bỏ phương án?",
  removeBody: "Màn [M] không đổi.",
};

test("history texts: same keys, kinds and arity in en and vi; no empty text", () => {
  const { en, vi } = HISTORY_TEXTS;
  assert.deepEqual(Object.keys(vi).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en)) {
    assert.equal(typeof vi[k], typeof en[k], k);
    if (typeof en[k] === "function") assert.equal(vi[k].length, en[k].length, k);
    if (typeof en[k] === "object") assert.deepEqual(Object.keys(vi[k]).sort(), Object.keys(en[k]).sort(), k);
  }
  for (const [k, s] of [...Object.entries(sample(en)), ...Object.entries(sample(vi))]) assert.ok(typeof s === "string" && s.trim(), k);
});

test("history texts (vi): exactly the texts the studio showed in earlier versions", () => {
  assert.deepEqual(sample(HISTORY_TEXTS.vi), VI);
});

test("history texts (en): every text is English, params shown", () => {
  const s = sample(HISTORY_TEXTS.en);
  assert.deepEqual(Object.keys(s).sort(), Object.keys(VI).sort(), "every text has a case above");
  for (const [k, v] of Object.entries(s)) assert.doesNotMatch(v, VIETNAMESE, `${k}: ${v}`);
  for (const k of ["snapshotHeading", "restoreTitle"]) for (const p of ["[F]", "[D]", "[T]"]) assert.ok(s[k].includes(p), `${k} shows ${p}`);
  for (const p of ["[N]", "[R]", "[M]", "[S]"]) assert.ok(s.optionBar.includes(p), `optionBar shows ${p}`);
  assert.equal(s["changedScreens#1"], "1 screen changed");
  assert.equal(s["changedScreens#3"], "3 screens changed");
});

test("T is the page's language (English when there is no page)", () => {
  assert.equal(T, HISTORY_TEXTS.en);
});

test("English times and days read naturally (5:56 AM; Sat, Oct 24, 2026); Vietnamese stay as before (05:56; T7, 24/10/2026)", () => {
  const at = new Date(2026, 9, 24, 5, 56);
  const { en, vi } = HISTORY_TEXTS;
  assert.equal(at.toLocaleTimeString("en-US", en.timeFormat), "5:56 AM");
  assert.equal(at.toLocaleDateString("en-US", en.dayFormat), "Sat, Oct 24, 2026");
  assert.equal(at.toLocaleTimeString("vi-VN", vi.timeFormat), at.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }));
  assert.equal(at.toLocaleDateString("vi-VN", vi.dayFormat), at.toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }));
});
