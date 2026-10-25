// Texts of the studio shell and its UI kit (studio/src/i18n/shell.ts: main.tsx, Sidebar, Canvas, Frame, frame-entry,
// collab; studio/src/i18n/ui.ts: the kit's default texts). The Vietnamese side is word for word what the studio showed
// in earlier versions (projects' own tests may match these strings); the English side has no Vietnamese; both sides
// have the same keys, kinds and arity. The dictionaries import "./index" without an extension (Vite style): a resolve
// hook maps it to index.ts so Node can load the .ts files directly. Under Node there is no document, so T is English.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { VIETNAMESE } from "./i18n-gate.mjs";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./index" && /\/src\/i18n\/(shell|ui)\.ts$/.test(context.parentURL ?? "")) return next("./index.ts", context);
    return next(specifier, context);
  },
});
const { SHELL_TEXTS, T, personName, withViewerName } = await import("../src/i18n/shell.ts");
const { UI_TEXTS } = await import("../src/i18n/ui.ts");

/** Every text of one language, rendered with fixed params → { "key[#case]": string }. */
function shellSample(t) {
  const s = {};
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === "string") s[k] = v;
    else if (v && typeof v === "object") for (const [k2, v2] of Object.entries(v)) s[`${k}.${k2}`] = v2;
  }
  return Object.assign(s, {
    "scenarioCount#1": t.scenarioCount(1),
    "scenarioCount#3": t.scenarioCount(3),
    "versionOption#live": t.versionOption({ title: "V1", live: true }),
    "versionOption#other": t.versionOption({ title: "V1", live: false }),
    compareWith: t.compareWith("V2"),
    "redrawing#sent": t.redrawing("#2"),
    "redrawing#pending": t.redrawing("+1"),
    noBoards: t.noBoards("main"),
    "othersHere#1": t.othersHere(1),
    "othersHere#2": t.othersHere(2),
    "peerLabel#board": t.peerLabel({ name: "ana", where: "Today" }),
    "peerLabel#list": t.peerLabel({ name: "ana" }),
    "peerLabel#version": t.peerLabel({ name: "ana", where: "Today", version: "V2" }),
    optionNamed: t.optionNamed("Three buttons"),
    noMatch: t.noMatch("xyz"),
    optionRowTitle: t.optionRowTitle({ name: "Three buttons", of: "Today", status: "[S]" }),
    "boardRowTitle#1": t.boardRowTitle({ title: "Today", n: 1 }),
    "boardRowTitle#3": t.boardRowTitle({ title: "Today", n: 3 }),
    viewingNow: t.viewingNow("ana, bob"),
    "boardError#line": t.boardError({ line: 12, message: "Unexpected token" }),
    "boardError#noLine": t.boardError({ line: null, message: "Unexpected token" }),
    boardMissing: t.boardMissing({ version: "main", id: "screens/a" }),
  });
}

function uiSample(t) {
  const s = {};
  for (const [k, v] of Object.entries(t)) if (typeof v === "string") s[k] = v;
  return Object.assign(s, { "loadFailed#default": t.loadFailed(), "loadFailed#what": t.loadFailed("[W]") });
}

/** Keys of both languages agree, and so do their kinds (string / function / object) and function arities. */
function sameShape(en, vi) {
  assert.deepEqual(Object.keys(vi).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en)) {
    assert.equal(typeof vi[k], typeof en[k], k);
    if (typeof en[k] === "function") assert.equal(vi[k].length, en[k].length, k);
    else if (typeof en[k] === "object") assert.deepEqual(Object.keys(vi[k]).sort(), Object.keys(en[k]).sort(), k);
    else assert.ok(en[k].trim() && vi[k].trim(), `${k}: empty text`);
  }
}

test("shell + ui kit: same keys, kinds and arity in en and vi", () => {
  sameShape(SHELL_TEXTS.en, SHELL_TEXTS.vi);
  sameShape(UI_TEXTS.en, UI_TEXTS.vi);
});

test("shell + ui kit (en): no Vietnamese, nothing empty", () => {
  for (const [k, v] of Object.entries({ ...shellSample(SHELL_TEXTS.en), ...uiSample(UI_TEXTS.en) })) {
    assert.ok(v.trim(), `${k}: empty`);
    assert.doesNotMatch(v, VIETNAMESE, `${k}: ${v}`);
  }
});

test("shell (en): counts agree with their number", () => {
  const en = SHELL_TEXTS.en;
  assert.equal(en.scenarioCount(1), "1 scenario");
  assert.equal(en.scenarioCount(3), "3 scenarios");
  assert.equal(en.othersHere(1), "1 other person has the studio open");
  assert.equal(en.othersHere(4), "4 other people have the studio open");
  assert.equal(en.boardRowTitle({ title: "Today", n: 1 }), "Today · 1 scenario");
});

// What the studio showed in earlier versions, from the old literals of main.tsx, Sidebar, Canvas, Frame, frame-entry and
// collab.ts. One deliberate change: noBoards names the folder boards live in (versions/<v>/boards/).
const VI_SHELL = {
  panelResizeLabel: "Kéo để đổi độ rộng ngăn hội thoại",
  panelResizeHint: "Kéo để đổi độ rộng · bấm đúp để về mặc định",
  studioTagline: "Xưởng thiết kế",
  signOut: "Đăng xuất",
  language: "Ngôn ngữ",
  boardList: "Danh mục",
  closeCode: "Đóng ngăn code",
  openCode: "Sửa code bản vẽ (cùng sửa)",
  boardCode: "Code bản vẽ",
  createOptionHint: "Tạo phương án — bản sao để thử hướng khác, màn chính giữ nguyên",
  createOption: "Tạo phương án",
  editScreenInfoHint: "Sửa thông tin màn (tên, mô tả, kịch bản)",
  editScreenInfo: "Sửa thông tin màn",
  "scenarioCount#1": "1 kịch bản",
  "scenarioCount#3": "3 kịch bản",
  version: "Phiên bản",
  "versionOption#live": "V1 · đang chạy",
  "versionOption#other": "V1",
  manageVersions: "Quản lý phiên bản…",
  compare: "So sánh",
  noCompare: "Không so sánh",
  compareWith: "So với V2",
  phone: "Điện thoại",
  fullDeviceWide: "Cả trang · cao tự do",
  frames: "Khung",
  viewportBoth: "Desktop + Mobile",
  "viewport.desktop": "Desktop",
  "viewport.mobile": "Mobile",
  openSpec: "Mở bảng đặc tả",
  collapseSpec: "Thu gọn bảng đặc tả",
  spec: "Đặc tả",
  theme: "Giao diện",
  themeLight: "Sáng",
  themeDark: "Tối",
  markHint: "Khoanh vùng để gắn vào tin nhắn (phím C, Esc để thoát)",
  mark: "Khoanh",
  marking: "Đang khoanh",
  "redrawing#sent": "Vẽ lại #2",
  "redrawing#pending": "Vẽ lại +1",
  conversation: "Hội thoại",
  design: "Toàn thiết kế",
  history: "Lịch sử",
  noBoards: "Chưa có bản vẽ nào trong versions/main/boards/.",
  "othersHere#1": "1 người khác đang mở xưởng",
  "othersHere#2": "2 người khác đang mở xưởng",
  "peerLabel#board": "ana · đang xem Today",
  "peerLabel#list": "ana · đang xem danh mục",
  "peerLabel#version": "ana · đang xem Today (V2)",
  mainScreen: "màn chính",
  removedOption: "phương án đã bỏ",
  optionNamed: "phương án “Three buttons”",
  otherSection: "Khác",
  searchBoards: "Tìm bản vẽ…",
  clearSearch: "Xoá tìm",
  noMatch: "Không có bản vẽ khớp “xyz”.",
  optionRowTitle: "Phương án “Three buttons” của Today · [S]",
  "boardRowTitle#1": "Today · 1 kịch bản",
  "boardRowTitle#3": "Today · 3 kịch bản",
  changedHint: "Khác bản nguồn",
  changedLabel: "đã đổi so với bản nguồn",
  viewingNow: "Đang xem: ana, bob",
  zoomOut: "Thu nhỏ",
  zoomOutHint: "Thu nhỏ (lăn chuột)",
  zoomReset: "Về 100%",
  zoomIn: "Phóng to",
  zoomInHint: "Phóng to (lăn chuột)",
  fit: "Vừa màn",
  openFrameHint: "Mở khung riêng",
  openFrame: "Mở riêng",
  "boardError#line": "Lỗi dòng 12: Unexpected token",
  "boardError#noLine": "Lỗi: Unexpected token",
  boardMissing: "Phiên bản “main” không có bản vẽ “screens/a”.",
  frameTitle: "Khung",
  localUser: "Claude (máy)",
  guest: "khách",
};

test("shell (vi): exactly the texts the studio showed in earlier versions", () => {
  const got = shellSample(SHELL_TEXTS.vi);
  for (const [k, want] of Object.entries(VI_SHELL)) assert.equal(got[k], want, k);
  assert.deepEqual(Object.keys(got).filter((k) => !(k in VI_SHELL)), [], "every text has a case above");
  const sampled = (k) => Object.keys(got).some((s) => s === k || s.startsWith(`${k}#`) || s.startsWith(`${k}.`));
  assert.deepEqual(Object.keys(SHELL_TEXTS.vi).filter((k) => !sampled(k)), [], "every key is rendered by shellSample");
  assert.deepEqual(Object.keys(UI_TEXTS.vi).filter((k) => !(k in uiSample(UI_TEXTS.vi)) && !(`${k}#default` in uiSample(UI_TEXTS.vi))), []);
});

test("ui kit (vi): exactly the default texts the kit showed in earlier versions", () => {
  assert.deepEqual(uiSample(UI_TEXTS.vi), {
    cancel: "Huỷ",
    working: "Đang xử lý…",
    "loadFailed#default": "Không tải được dữ liệu",
    "loadFailed#what": "Không tải được [W]",
    loadFailedDetail: "Có thể do mạng chập chờn. Dữ liệu của bạn không bị mất.",
    referenceCode: "Mã tra cứu:",
    retrying: "Đang thử lại…",
    retry: "Thử lại",
    close: "Đóng",
  });
});

test("personName: this machine's user, else the part of the email before @, else guest — in the given language", () => {
  assert.equal(personName("claude@local"), T.localUser);
  assert.equal(personName("claude@local", SHELL_TEXTS.en), "Claude (this machine)");
  assert.equal(personName("claude@local", SHELL_TEXTS.vi), "Claude (máy)");
  assert.equal(personName("ana@example.org"), "ana");
  assert.equal(personName("@example.org", SHELL_TEXTS.en), "guest");
  assert.equal(personName("@example.org", SHELL_TEXTS.vi), "khách");
});

test("withViewerName: a person received from another tab is named in THIS viewer's language, the rest kept", () => {
  const sent = { name: "Claude (máy)", email: "claude@local", color: "#0f766e", colorLight: "#0f766e33" };
  assert.deepEqual(withViewerName(sent), { ...sent, name: "Claude (this machine)" });
  assert.deepEqual(withViewerName({ ...sent, name: "x", email: "bob@x.org" }), { ...sent, name: "bob", email: "bob@x.org" });
});
