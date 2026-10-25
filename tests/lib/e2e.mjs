// Shared helpers for tests/*.e2e.mjs. The studio must already be running — tests/run-e2e.mjs starts one on the
// example project (port 5190) and passes its address in STUDIO and its folder in CRAFT_PROJECT. Requests from this
// machine act as "claude@local" (no sign-in); threads created here pass noAgent, and every page sets the studio's
// "studio:noAgent" switch, so no test ever runs the real Claude. Tests that edit files do it in a throwaway version
// (tempVersion), never in the live one. Clean-ups run even when the test is interrupted (lib/lifecycle.mjs).
// Screenshots go to tests/shots/ (git-ignored).
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { createLifecycle } from "./lifecycle.mjs";
import { retry } from "./retry.mjs";

export const STUDIO = (process.env.STUDIO ?? "http://127.0.0.1:5190").replace(/\/+$/, "");
/** Folder of the project the studio serves (files on disk: versions/, threads/, data/). */
export const PROJECT = path.resolve(process.env.CRAFT_PROJECT ?? new URL("../../example", import.meta.url).pathname);
export const SHOTS = new URL("../shots/", import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });

// Words of the studio UI that tests look for (button text, titles, aria-labels), in both languages of the studio
//. The viewer's language is the ct_lang cookie, else the project's "language" — the example is
// "en", so a fresh browser sees English and tests use UI (= UI_TEXTS.en). These are copies of words of the
// studio's dictionaries (studio/src/i18n/*.ts); the comment of each word names its dictionary key, and
// tests/e2e-texts.test.mjs fails when a copy is no longer part of its dictionary. Tests prefer data-* attributes
// wherever the UI has one.
const en = {
  send: "Send", // composer send button — threads.ts send
  openBigComposer: "Open the large composer", // aria-label of the composer's expand button — threads.ts openBigComposer
  annotateTitle: "Mark an area to attach", // title prefix of the toolbar's mark button — shell.ts markHint
  annotate: "Mark", // its text when idle — shell.ts mark (threads.ts mark in the composer)
  redraw: "Redraw", // its text while redrawing "#n" / "+n" — shell.ts redrawing; the marks list's button — threads.ts redraw
  redrawn: "redrawn", // status of a redrawn mark in the list — threads.ts statusRedrawn
  backToThreads: "Back to threads", // aria-label of the thread header's back button — threads.ts backToThreads
  mainScreen: "the main screen", // label of a thread of the main screen, seen from an option — shell.ts mainScreen
  renameOption: "Rename option", // aria-label of the pencil on the option bar — history.ts renameOption
  annotating: "Marking", // the toolbar's mark button while mark mode is on — shell.ts marking
  zoomReset: "Reset to 100%", // title of the canvas zoom label (click → 100%) — shell.ts zoomReset
  fit: "Fit to screen", // aria-label of the canvas "fit" button — shell.ts fit
  waitingForYou: "Your turn", // thread list badge: Claude asked a question — threads.ts yourTurn
  queued: "Queued", // thread list badge: waiting for Claude to finish another thread of the screen — threads.ts queuedBadge
  claudeBusy: "Claude is editing this screen", // strip on the spec panel while Claude edits the screen — spec.ts claudeBusy
  unqueue: "Leave the queue", // button in a queued thread — threads.ts unqueue
  behaviorTab: "Behavior", // spec tab (and history label) of <id>.behavior.md — spec.ts behavior, history.ts file.behavior
  techTab: "Technical", // spec tab of <id>.tech.md — spec.ts tech
  specEmpty: "This tab has no content yet.", // a spec tab (or the /spec page) with nothing to show — spec.ts tabEmpty
  collapseSpec: "Collapse spec", // aria-label: fold the spec panel — spec.ts collapseSpec
  openSpec: "Open spec", // aria-label: unfold it — spec.ts openSpec
  versionSelect: "Version", // aria-label of the version select in the header — shell.ts version
  deviceSelect: "Phone", // aria-label of the phone select in the header — shell.ts phone
  restore: "Restore", // history: restore button — history.ts restore
  restoreConfirm: "Restore this snapshot", // history: confirm restore — history.ts restoreConfirm
  addScenario: "Add scenario", // screen info form: add a scenario — spec.ts addScenario
  createOption: "New option", // aria-label of the header button (shell.ts createOption); the dialog's title (history.ts createOption)
  create: "Create", // the dialog's create button — history.ts create
  adoptOption: "Adopt this option", // option bar: adopt (copy over the main screen) — history.ts adoptThis
  adoptConfirm: "Adopt", // confirm dialog of adopt — history.ts adopt
  removeOption: "Remove option", // option bar: remove; also the confirm button — history.ts removeOption
  localUser: "Claude (this machine)", // name shown for "claude@local" (this machine) in presence — shell.ts localUser
  language: "Language", // aria-label of the language switch (sidebar foot, the phone's drawer) — shell.ts language
  boardList: "Boards", // aria-label of the phone's button that opens the board list drawer — shell.ts boardList
  conversation: "Conversation", // the right panel's tab — shell.ts conversation
  history: "History", // the right panel's other tab — shell.ts history
  lookingAt: "looking at", // on a whole-design message sent while looking at another screen — threads.ts lookingAt
  newThread: "New thread", // the button that starts a thread — threads.ts newThread
  mark: "Mark", // the composer's mark button — shell.ts / threads.ts mark
};
/** The same words in Vietnamese (lang.e2e.mjs): the vi side of the same dictionary keys. */
const vi = {
  send: "Gửi",
  openBigComposer: "Mở khung soạn lớn",
  annotateTitle: "Khoanh vùng để gắn",
  annotate: "Khoanh",
  redraw: "Vẽ lại",
  redrawn: "đã vẽ lại",
  backToThreads: "Về danh sách luồng",
  mainScreen: "màn chính",
  renameOption: "Đổi tên phương án",
  annotating: "Đang khoanh",
  zoomReset: "Về 100%",
  fit: "Vừa màn",
  waitingForYou: "Chờ bạn",
  queued: "Chờ lượt",
  claudeBusy: "Claude đang sửa màn này",
  unqueue: "Bỏ chờ",
  behaviorTab: "Hành vi",
  techTab: "Kỹ thuật",
  specEmpty: "Tab này chưa có nội dung.",
  collapseSpec: "Thu gọn đặc tả",
  openSpec: "Mở đặc tả",
  versionSelect: "Phiên bản",
  deviceSelect: "Điện thoại",
  restore: "Khôi phục",
  restoreConfirm: "Khôi phục bản này",
  addScenario: "Thêm kịch bản",
  createOption: "Tạo phương án",
  create: "Tạo",
  adoptOption: "Chốt phương án này",
  adoptConfirm: "Chốt",
  removeOption: "Bỏ phương án",
  localUser: "Claude (máy)",
  language: "Ngôn ngữ",
  boardList: "Danh mục",
  conversation: "Hội thoại",
  history: "Lịch sử",
  lookingAt: "đang xem",
  newThread: "Luồng mới",
  mark: "Khoanh",
};
export const UI_TEXTS = { en, vi };
/** The words of the UI the example project shows to a fresh browser (English). */
export const UI = en;
/** Name of the cookie that holds the viewer's language (studio/lib/i18n.mjs LANG_COOKIE). */
export const LANG_COOKIE = "ct_lang";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const life = createLifecycle();

/**
 * JSON API of the studio. Throws on a non-2xx answer. After an interrupt only clean-ups may call it; a call started
 * before the interrupt is waited for, so what it creates still gets cleaned up.
 */
export const api = (method, p, body) => life.track(async () => {
  const r = await fetch(STUDIO + p, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(j)}`);
  return j;
});

/** Every board of a version (default: the live one) → [{ id, meta }]. */
export const entries = async (v) => (await api("GET", `/__api/entries${v ? `?v=${encodeURIComponent(v)}` : ""}`)).entries;
/** The studio's versions → { versions: [...], live }. */
export const versions = () => api("GET", "/__api/versions");

/** Assertion that prints a ✓ line, or throws with a ✗ line. */
export function ok(cond, msg) {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
}

/** Poll `fn` until it returns something truthy (or throw after `ms`). */
export async function until(fn, what, ms = 15_000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await fn()) return; await sleep(150); }
  throw new Error(`✗ timed out waiting for: ${what}`);
}

export const DESKTOP = { width: 1280, height: 800 };
export const PHONE = { width: 390, height: 780, isMobile: true, hasTouch: true };

/**
 * Headless Chrome for one test file. Puppeteer's own signal handlers are off: on Ctrl+C they kill Chrome and exit the
 * process before any clean-up runs — run() closes the browser itself. A start that crashes (it happens on a busy
 * machine) is retried.
 */
export const LAUNCH_OPTIONS = {
  headless: true, timeout: 120_000, protocolTimeout: 300_000,
  handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
};
export const launch = () => retry(() => puppeteer.launch(LAUNCH_OPTIONS), { tries: 3, onRetry: (e) => console.log(`! Chrome did not start (${String(e.message).split("\n")[0]}) — trying again`) });

/** New page: viewport, generous timeouts (a busy machine can take 20 s to open a page), no Claude. */
export async function newPage(browser, viewport = DESKTOP) {
  const page = await browser.newPage();
  page.setDefaultTimeout(120_000);
  page.setDefaultNavigationTimeout(120_000);
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem("studio:noAgent", "1"); } catch { /* private mode */ } });
  return page;
}

/** Studio page for some URL parameters, e.g. studioUrl({ e: "screens/tasks/list", t: id }). */
export const studioUrl = (params) => `${STUDIO}/?${Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;

/** Screenshot into tests/shots/. */
export const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png` });

/** Open a studio page and wait until it has drawn: React root filled and every frame on it rendered. */
export async function gotoReady(page, url) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const r = document.getElementById("root");
    if (!r || !r.children.length) return false;
    return [...document.querySelectorAll("iframe")].every((f) => {
      const d = f.contentDocument;
      return d && d.readyState === "complete" && (d.getElementById("root")?.children.length || (d.body?.innerText ?? "").length);
    });
  }, { timeout: 60_000, polling: 200 }).catch(() => {});
  await sleep(300);
}

/** A file of the project, e.g. projectFile("versions", v, "boards", "screens/tasks/list.tsx"). */
export const projectFile = (...parts) => path.join(PROJECT, ...parts);
/** A board file of version `v`: boardFile(v, "screens/tasks/list.behavior.md"). */
export const boardFile = (v, rel) => projectFile("versions", v, "boards", ...rel.split("/"));

/**
 * A throwaway copy of the live version for a test that edits files: created through the API, removed by the
 * clean-up (after the browser has closed — removing files a page shows makes Vite reload it). Returns its id.
 */
export async function tempVersion(cleanup, title) {
  const { live } = await versions();
  const { version } = await api("POST", "/__api/versions", { from: live, title, note: "made by an e2e test, removed at its end" });
  cleanup(`version ${version.id}`, () => api("DELETE", `/__api/versions/${version.id}`));
  return version.id;
}

/**
 * Run a test body with one browser and clean-up steps that always run (threads, options, versions… the test
 * created; newest first, once the browser has closed) — after a pass, a failure, or an interrupt (SIGINT/SIGTERM) —
 * then exit: 0 passed, 1 failed, 130 interrupted. tests/run-e2e.mjs reads the exit code.
 */
export const run = (name, body) => life.run(name, body, { launch });
