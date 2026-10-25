// Texts of the conversation panel (studio/src/i18n/threads.ts, used by ThreadsPanel): both languages in step, the
// Vietnamese texts exactly as the panel showed them in earlier versions (projects' own tests may match them), the
// English texts free of Vietnamese, and dates / counts in each language's own form.
// threads.ts imports "./index" without an extension (Vite style); Node needs one, so a resolve hook adds ".ts".
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { VIETNAMESE } from "./i18n-gate.mjs";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw e;
    }
  },
});
const { T, TEXTS, threadTitle } = await import("../src/i18n/threads.ts");
const { en, vi } = TEXTS;

test("threadTitle: a thread stored without a title shows the default name of the page's language", () => {
  assert.equal(threadTitle(""), "New thread");
  assert.equal(threadTitle("   "), "New thread");
  assert.equal(threadTitle(undefined), "New thread");
  assert.equal(threadTitle("Bàn về nút gửi"), "Bàn về nút gửi", "a real title is shown as it is, in any language");
  assert.equal(threadTitle("Luồng mới"), "Luồng mới", "a stored default keeps the language it was created in");
});

test("threads texts: same keys in en and vi, same kind and arity, no empty text", () => {
  assert.deepEqual(Object.keys(vi).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en)) {
    assert.equal(typeof vi[k], typeof en[k], k);
    if (typeof en[k] === "function") assert.equal(vi[k].length, en[k].length, k);
    else assert.ok(en[k].trim() && vi[k].trim(), k);
  }
});

test("threads texts: a page with no language (node, no document) reads English", () => {
  assert.equal(T, en);
  assert.equal(T.yourTurn, "Your turn");
  assert.equal(T.queuedBadge, "Queued");
});

// Every fixed Vietnamese text, exactly as ThreadsPanel wrote it in earlier versions.
const VI = {
  conversation: "Hội thoại",
  noThreadsGlobal: "Nhờ bất cứ điều gì về thiết kế — đổi một màn hay đổi tất cả. Nhắc một màn bằng @.",
  messageClaudeGlobal: "Nhờ đổi gì đó — gõ @ để nhắc một màn…",
  mention: "Màn",
  mentionHint: "Nhắc một màn trong tin nhắn (hoặc gõ @)",
  mentionMenu: "Các màn",
  mentionNone: "Không có màn nào khớp",
  mentionGone: "Màn này không còn trong phiên bản này",
  runModel: "Model",
  runEffort: "Effort",
  runHint: "Áp dụng cho tin nhắn kế tiếp",
  runSettings: "Model và effort",
  scriptsOff: "Script: tắt",
  newThread: "Luồng mới",
  noThreads: "Chưa có luồng nào",
  lastImage: "(ảnh)",
  lastMark: "(khoanh)",
  working: "Claude đang làm",
  queuedBadge: "Chờ lượt",
  queuedHint: "Chờ Claude xong luồng khác trên màn này",
  errorBadge: "Lỗi",
  closedBadge: "Đã đóng",
  yourTurn: "Chờ bạn",
  backToThreads: "Về danh sách luồng",
  close: "Đóng",
  renamePrompt: "Đổi tên luồng",
  rename: "Đổi tên",
  marksToggle: "Danh sách khoanh — bỏ hoặc vẽ lại",
  closeThread: "Đóng luồng (đã xong)",
  reopenThread: "Mở lại luồng",
  deleteThread: "Xoá luồng",
  deleteConfirm: "Xoá luồng này?",
  markRemoved: "Khoanh đã bỏ",
  chipRemove: "Bỏ vùng khoanh",
  removeMark: "Bỏ khoanh",
  restore: "Khôi phục",
  redraw: "Vẽ lại",
  redrawing: "Đang vẽ lại",
  redrawHint: "Vẽ lại vùng này trên bảng vẽ (giữ số)",
  statusRemoved: "đã bỏ",
  statusRedrawn: "đã vẽ lại",
  openImage: "Mở ảnh",
  attachedImage: "Ảnh đính kèm",
  workingLong: "Claude đang làm…",
  stop: "Dừng",
  waitingTurn: "Đang chờ lượt",
  busyElsewhere: "Claude đang sửa màn này ở luồng khác.",
  unqueue: "Bỏ chờ",
  turnFailed: "Lượt của Claude bị lỗi",
  runAgain: "Chạy lại",
  askClaude: "Gửi cho Claude trả lời",
  messageClaude: "Nhắn Claude…",
  reply: "Trả lời…",
  replyToReopen: "Gửi để mở lại luồng…",
  markHint: "Khoanh vùng trên bảng vẽ để gắn vào tin (phím C)",
  mark: "Khoanh",
  marking: "Đang khoanh",
  image: "Ảnh",
  removeImage: "Bỏ ảnh",
  shrinkComposer: "Thu nhỏ ô soạn",
  shrinkComposerHint: "Thu nhỏ ô soạn (Esc)",
  openBigComposer: "Mở khung soạn lớn",
  openBigComposerHint: "Mở khung soạn lớn — gõ văn bản nhiều đoạn",
  send: "Gửi",
  sendHint: "Gửi (Enter) · Shift+Enter để xuống dòng",
  sendHintBig: "Gửi (Ctrl+Enter)",
  compose: "Soạn tin",
};

// A fixed local time, so the result does not depend on the machine's time zone.
const AT = new Date(2026, 9, 4, 9, 5);

test("threads texts (vi): exactly the texts the panel showed in earlier versions", () => {
  for (const [k, want] of Object.entries(VI)) assert.equal(vi[k], want, k);
  const fixed = Object.keys(vi).filter((k) => typeof vi[k] === "string").sort();
  assert.deepEqual(fixed, Object.keys(VI).sort(), "every fixed text has a case above");
  assert.equal(vi.closedCount(3), "Đã đóng (3)");
  assert.equal(vi.messageCount(1), "1 tin");
  assert.equal(vi.messageCount(5), "5 tin");
  assert.equal(vi.fromClaude("Đã sửa nút"), "Claude: Đã sửa nút");
  assert.equal(vi.onMember("phương án “Thử cụm”"), "trên phương án “Thử cụm”");
  assert.equal(vi.lookingAt("Đơn hàng"), "đang xem Đơn hàng");
  assert.equal(vi.runDefault("Sonnet 5.5"), "Mặc định (Sonnet 5.5)");
  assert.deepEqual(["", "low", "medium", "high", "xhigh", "max"].map(vi.effortLevel), ["Mặc định", "Thấp", "Vừa", "Cao", "Rất cao", "Tối đa"]);
  assert.equal(vi.effortLevel("unknown"), "unknown");
  assert.equal(vi.scriptsOn("bwrap"), "Script: bwrap");
  assert.equal(vi.attachHint(6), "Đính kèm ảnh (tối đa 6) — hoặc dán / kéo thả ảnh vào đây");
  assert.equal(vi.stamp(AT, true), "09:05", "today: hours and minutes");
  assert.equal(vi.stamp(AT, false), "09:05 04/10", "another day: then day/month");
  assert.equal(vi.stamp(new Date(2026, 11, 31, 23, 59), false), "23:59 31/12");
});

test("threads texts (en): counts in English plural, dates in the en-US locale", () => {
  assert.equal(en.messageCount(1), "1 message");
  assert.equal(en.messageCount(0), "0 messages");
  assert.equal(en.messageCount(5), "5 messages");
  assert.equal(en.closedCount(3), "Closed (3)");
  assert.equal(en.onMember("the main screen"), "on the main screen");
  assert.equal(en.lookingAt("Orders"), "looking at Orders");
  assert.equal(en.runDefault("Sonnet 5.5"), "Default (Sonnet 5.5)");
  assert.deepEqual(["", "low", "medium", "high", "xhigh", "max"].map(en.effortLevel), ["Default", "Low", "Medium", "High", "Extra high", "Max"]);
  assert.equal(en.runSettings, "Model and effort");
  assert.equal(en.scriptsOn("bwrap"), "Scripts: bwrap");
  assert.equal(en.scriptsOff, "Scripts: off");
  assert.equal(en.attachHint(6).includes("6"), true);
  assert.match(en.stamp(AT, true), /^9:05\sAM$/u, "today: time only, 12-hour clock");
  assert.match(en.stamp(AT, false), /^Oct 4, 9:05\sAM$/u, "another day: month and day first");
  assert.match(en.stamp(new Date(2026, 11, 31, 23, 59), false), /^Dec 31, 11:59\sPM$/u);
});

test("threads texts (en): no Vietnamese in any English text", () => {
  for (const [k, v] of Object.entries(en)) {
    const s = typeof v === "function" ? (k === "stamp" ? v(AT, false) : v(3)) : v;
    assert.doesNotMatch(String(s), VIETNAMESE, `${k}: ${s}`);
  }
});
