// e2e: with the English UI, no Vietnamese anywhere a viewer reads. The example project is
// English (its boards, specs and data), so a Vietnamese letter on screen is a studio text that missed its dictionary.
// Visits every page and state reachable cheaply and reads, on the page and in its same-origin frames: every text node
// (also those hidden at this width — a superset of document.body.innerText), document.body.innerText itself, the
// title / aria-label / placeholder / alt / label attributes, and document.title. Checked with the i18n gate's own
// letters (studio/lib/i18n-gate.mjs VIETNAMESE). The one exempt text is the language switch's "Tiếng Việt" option,
// which names Vietnamese in Vietnamese on purpose (studio/src/i18n/LangSwitch.tsx).
// States: the studio home; a screen with its spec panel on both tabs, folded, and being edited; the screen info form;
// the code pane; the thread list (threads idle, waiting for you, running, queued, in error, closed); a new thread; a
// thread with marks (one removed, one redrawn), its marks list and the large composer; mark mode with a pending mark;
// presence of another tab; History and an open snapshot; an option being tried and an adopted one, its rename / adopt
// / remove dialogs and the new-option dialog; compare; /versions and its dialogs; /spec (both tabs, all pages);
// /frame (a board, a missing one); /__src; and the phone layout (drawer, chat sheet, spec sheet, history, option).
// Threads, the throwaway version and its options are created through the API (threads with noAgent; agent states
// faked on disk, as in claude-queue.e2e.mjs) and removed at the end. Screenshot of each state with a hit:
// tests/shots/no-vi-<state>.png
import fs from "node:fs";
import { VIETNAMESE } from "../studio/lib/i18n-gate.mjs";
import { DESKTOP, PHONE, STUDIO, UI, api, boardFile, entries, gotoReady, newPage, ok, projectFile, run, shot, sleep, studioUrl, tempVersion, versions } from "./lib/e2e.mjs";

const MAIN = "screens/tasks/list";
const OTHER = "screens/tasks/detail";
const R1 = { scenario: null, viewport: "desktop", rect: { x: 20, y: 20, w: 200, h: 60 }, texts: ["Add task"] };
const R2 = { scenario: null, viewport: "desktop", rect: { x: 300, y: 120, w: 160, h: 50 }, texts: ["Open"] };
/** The language switch's own option for Vietnamese: the only Vietnamese an English page may show. */
const EXEMPT = 'select:has(option[value="en"]):has(option[value="vi"]) option[value="vi"]';

/**
 * Every text a viewer can read on the page (and its same-origin frames) → [{ kind, text, where }]. `where` is a short
 * path of the element (tags with their data-* / role attributes) to find a hit in the source.
 */
function readable(exempt) {
  const out = [];
  const ATTRS = ["title", "aria-label", "placeholder", "alt", "label", "aria-description"];
  const docs = [document];
  for (const f of document.querySelectorAll("iframe")) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch { /* cross-origin */ } }
  for (const d of docs) {
    if (!d.body) continue;
    const where = (el) => {
      const parts = [];
      for (let e = el; e && e !== d.body && parts.length < 4; e = e.parentElement) {
        parts.unshift(e.tagName.toLowerCase() + [...e.attributes].filter((a) => a.name.startsWith("data-") || a.name === "role").map((a) => `[${a.name}${a.value && a.value.length < 30 ? `=${a.value}` : ""}]`).join(""));
      }
      return (d === document ? "" : "iframe: ") + parts.join(" > ");
    };
    const skip = (el) => !el || el.closest(`script, style, noscript, template, ${exempt}`);
    const walk = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.nodeValue.trim();
      if (t && !skip(n.parentElement)) out.push({ kind: "text", text: t, where: where(n.parentElement) });
    }
    for (const el of d.body.querySelectorAll("*")) {
      if (skip(el)) continue;
      for (const a of ATTRS) { const v = el.getAttribute(a); if (v) out.push({ kind: a, text: v, where: where(el) }); }
    }
    const exemptText = [...d.querySelectorAll(exempt)].map((o) => o.textContent.trim());
    const inner = d.body.innerText.split("\n").map((l) => l.trim()).filter((l) => l && !exemptText.includes(l));
    for (const l of inner) out.push({ kind: "innerText", text: l, where: d === document ? "body" : "iframe body" });
    if (d.title) out.push({ kind: "document.title", text: d.title, where: d === document ? "document" : "iframe" });
  }
  return out;
}

await run("no-vietnamese-ui", async ({ browser, cleanup }) => {
  const hits = []; // { state, kind, text, where }
  let states = 0;
  /** Read the page in its current state; remember every Vietnamese text. */
  const check = async (page, state) => {
    await sleep(400);
    const lang = await page.evaluate(() => document.documentElement.lang);
    const found = (await page.evaluate(readable, EXEMPT)).filter((x) => VIETNAMESE.test(x.text));
    if (lang && lang !== "en") found.push({ kind: "html lang", text: lang, where: "html" });
    const seen = new Set();
    for (const f of found) {
      const k = `${f.kind}|${f.text}`;
      if (seen.has(k)) continue;
      seen.add(k);
      hits.push({ state, ...f });
    }
    states++;
    if (found.length) {
      console.log(`✗ ${state}: ${seen.size} Vietnamese text(s)`);
      await shot(page, `no-vi-${state.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);
    } else console.log(`  ${state}: none`);
  };
  /** Open `url`, wait for `wait` (a selector) and for every text of `says` (proof the state is reached), then read it. */
  const visit = async (page, url, state, { wait, says = [], then } = {}) => {
    await gotoReady(page, url);
    if (wait) await page.waitForSelector(wait, { timeout: 30_000 });
    if (then) await then();
    if (says.length) {
      // Case-insensitive: innerText follows CSS text-transform (the closed threads' heading is uppercase).
      const missing = () => page.evaluate((ts) => ts.filter((t) => !document.body.innerText.toLowerCase().includes(t.toLowerCase())), says);
      await page.waitForFunction((ts) => ts.every((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase())), { timeout: 15_000, polling: 200 }, says).catch(() => {});
      const left = await missing();
      ok(left.length === 0, `${state}: the page shows ${says.map((t) => `"${t}"`).join(", ")}${left.length ? ` — missing: ${left.join(", ")}` : ""}`);
    }
    await check(page, state);
  };

  // ── What the states need: threads in every agent state, a throwaway version with two options ──
  const { live } = await versions();
  const mkThread = async (title, text, refs = []) => {
    const { thread } = await api("POST", "/__api/threads", { entry: MAIN, title, text, refs, noAgent: true });
    cleanup(`thread ${thread.id}`, async () => {
      setAgent(thread.id, { state: "idle", progress: null, error: null }); // never delete a "running" thread
      await api("DELETE", `/__api/threads/${thread.id}`);
    });
    return thread;
  };
  const fileOf = (id) => projectFile("threads", `${id}.json`);
  const setAgent = (id, patch) => {
    if (!fs.existsSync(fileOf(id))) return;
    const j = JSON.parse(fs.readFileSync(fileOf(id), "utf8"));
    j.agent = { ...j.agent, ...patch };
    fs.writeFileSync(fileOf(id), JSON.stringify(j, null, 2) + "\n");
  };
  const marks = await mkThread("Bigger add button", "Make this bigger [#1] and this one clearer [#2]", [R1, R2]);
  const mid = marks.messages[0].id;
  await api("POST", `/__api/threads/${marks.id}/claude`, { text: "**Done:** the button is bigger [#1].\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nShall I keep `A` or B?", refs: [{ ...R1, rect: { x: 40, y: 40, w: 120, h: 40 } }] });
  await api("PATCH", `/__api/threads/${marks.id}/refs`, { messageId: mid, index: 1, action: "remove" });
  await api("PATCH", `/__api/threads/${marks.id}/refs`, { messageId: mid, index: 0, action: "redraw", ref: { ...R1, rect: { x: 30, y: 30, w: 180, h: 50 } } });
  const running = await mkThread("Running thread", "Make the rows shorter");
  const queued = await mkThread("Queued thread", "Add a filter");
  const failed = await mkThread("Failed thread", "Change the colours");
  const closed = await mkThread("Closed thread", "Nothing to do");
  await api("PATCH", `/__api/threads/${closed.id}`, { status: "closed" });
  setAgent(running.id, { state: "running", progress: { key: "editing", params: { path: `${MAIN}.tsx` } } });
  setAgent(queued.id, { state: "queued", progress: { key: "queued", params: {} } });
  setAgent(failed.id, { state: "error", error: { key: "timedOut", params: { minutes: 10 } } });

  const v = await tempVersion(cleanup, "E2E no Vietnamese");
  const [trying] = (await api("POST", "/__api/options", { v, entries: [MAIN], name: "Compact rows" })).ids;
  const [adopted] = (await api("POST", "/__api/options", { v, entries: [MAIN], name: "Big buttons" })).ids;
  await api("POST", "/__api/options/adopt", { v, entry: adopted });
  const revs = (await api("GET", `/__api/history?v=${v}&entry=${encodeURIComponent(MAIN)}`)).revisions ?? [];
  const liveRevs = (await api("GET", `/__api/history?v=${live}&entry=${encodeURIComponent(MAIN)}`)).revisions ?? [];
  ok(revs.length > 0 && liveRevs.length > 0, `history to show: ${revs.length} snapshots of ${MAIN} in ${v}, ${liveRevs.length} in ${live}`);
  ok((await entries(v)).some((e) => e.id === trying), `option ${trying} exists in ${v}`);
  // The plain-language check in the project's language: the throwaway version's Behavior tab gets a code block (its
  // issue text must be English), its screen info words only the Vietnamese vocabulary flags (banner, session, state).
  fs.appendFileSync(boardFile(v, `${MAIN}.behavior.md`), "\n```js\nconst x = 1;\n```\n");
  const metaFile = boardFile(v, `${MAIN}.meta.json`);
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  fs.writeFileSync(metaFile, JSON.stringify({ ...meta, desc: `${meta.desc} A banner shows the session state.` }, null, 2) + "\n");

  // ── Desktop ──
  const page = await newPage(browser, DESKTOP);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  await visit(page, `${STUDIO}/`, "home");
  // English words of the states (studio/src/i18n/threads.ts, agent-texts.ts, history.ts, spec.ts).
  await visit(page, studioUrl({ e: MAIN }), "screen, spec Behavior, thread list", { wait: "[data-spec-panel]", says: [UI.waitingForYou, UI.queued, "Claude is working", "Error", "Closed (1)"] });
  await visit(page, studioUrl({ e: MAIN, sp: "tech" }), "spec Technical", { wait: "[data-spec-panel]" });
  await visit(page, studioUrl({ e: MAIN, spe: "1" }), "spec being edited", { wait: "[data-spec-panel] .cm-content" });
  await visit(page, studioUrl({ e: MAIN }), "spec folded", {
    wait: `[data-spec-panel] button[aria-label="${UI.collapseSpec}"]`,
    then: async () => { await page.click(`[data-spec-panel] button[aria-label="${UI.collapseSpec}"]`); await sleep(300); },
  });
  await page.click(`[data-spec-panel] button[aria-label="${UI.openSpec}"]`).catch(() => {}); // unfold again (stored per browser)
  await visit(page, studioUrl({ e: MAIN, meta: "1" }), "screen info form", { wait: "[data-meta-editor]" });
  await visit(page, studioUrl({ v, e: MAIN, spe: "1" }), "spec being edited, with a code block", { wait: "[data-spec-panel] .cm-content", says: ["1 place is not plain language yet"] });
  await visit(page, studioUrl({ v, e: MAIN, meta: "1" }), "screen info form, everyday English words", {
    wait: "[data-meta-editor]",
    then: () => page.waitForFunction(() => [...document.querySelectorAll("[data-meta-editor] textarea, [data-meta-editor] input")].some((f) => f.value.includes("A banner shows")), { timeout: 15_000 }),
  });
  const flagged = await page.evaluate(() => document.querySelector("[data-meta-editor]")?.innerText.match(/Not plain language yet.*/)?.[0] ?? "");
  ok(flagged === "", `the screen info form checks English with the English words (banner, session, state pass)${flagged ? ` — shows "${flagged}"` : ""}`);
  await visit(page, studioUrl({ e: MAIN, code: "1" }), "code pane", { wait: "[data-code-editor] .cm-content" });
  await visit(page, studioUrl({ e: MAIN, t: "new" }), "new thread", { wait: "[data-panel] [data-composer]" });
  await visit(page, studioUrl({ e: MAIN, t: marks.id }), "thread with marks and a reply", { wait: "[data-panel] [data-refs-toggle]" });
  await visit(page, studioUrl({ e: MAIN, t: marks.id, kh: "1" }), "marks list", { wait: "[data-panel] [data-ref-list]", says: [UI.redrawn, "removed"] });
  await visit(page, studioUrl({ e: MAIN, t: marks.id, soan: "1" }), "large composer", { wait: "[data-composer-lon]" });
  await visit(page, studioUrl({ e: MAIN, t: marks.id }), "mark mode, a pending mark", {
    wait: "[data-panel] [data-composer] textarea",
    then: async () => {
      await page.keyboard.press("c");
      const r = await page.$eval("iframe", (f) => { const b = f.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
      await page.mouse.move(r.x + r.w * 0.2, r.y + r.h * 0.4);
      await page.mouse.down();
      await page.mouse.move(r.x + r.w * 0.45, r.y + r.h * 0.55, { steps: 6 });
      await page.mouse.up();
      await page.waitForSelector("[data-panel] [data-pending-refs]", { timeout: 10_000 });
    },
  });
  await page.keyboard.press("Escape");
  await visit(page, studioUrl({ e: MAIN, t: running.id }), "thread: Claude running", { wait: "[data-panel] [data-composer]", says: ["Claude is working…", UI.claudeBusy] });
  await visit(page, studioUrl({ e: MAIN, t: queued.id }), "thread: queued", { wait: "[data-queued]", says: [UI.unqueue] });
  await visit(page, studioUrl({ e: MAIN, t: failed.id }), "thread: error", { wait: "[data-panel] [data-composer]", says: ["Claude's turn failed", "Run again"] });
  await visit(page, studioUrl({ e: MAIN, t: closed.id }), "thread: closed", { wait: "[data-panel] [data-composer]" });
  {
    const other = await newPage(browser, DESKTOP);
    await gotoReady(other, studioUrl({ e: OTHER }));
    await visit(page, studioUrl({ e: MAIN }), "presence of another tab", { wait: "[data-presence] button" });
    await other.close();
  }
  await visit(page, studioUrl({ e: MAIN, rp: "history" }), "history", { wait: "[data-rev]" });
  const snapshotShown = () => page.waitForFunction(() => {
    const p = document.querySelector("[data-panel]")?.innerText ?? "";
    return p.length > 0 && !p.includes("Loading…");
  }, { timeout: 15_000 });
  await visit(page, studioUrl({ e: MAIN, rp: "history", hist: String(liveRevs.at(-1).id) }), "history snapshot", { wait: "[data-panel]", then: snapshotShown });
  await visit(page, studioUrl({ v, e: MAIN, rp: "history" }), "history with an adopted option", { wait: "[data-rev]" });
  const adoption = revs.find((r) => r.source === "option") ?? revs[0];
  await visit(page, studioUrl({ v, e: MAIN, rp: "history", hist: String(adoption.id) }), "history snapshot of an adoption", { wait: "[data-panel]", then: snapshotShown });
  await visit(page, studioUrl({ v, e: trying }), "option bar (trying)", { wait: "[data-option-bar]" });
  await visit(page, studioUrl({ v, e: adopted }), "option bar (adopted)", { wait: "[data-option-bar]" });
  for (const opt of ["rename", "adopt", "remove"]) {
    await visit(page, studioUrl({ v, e: trying, opt }), `option dialog: ${opt}`, { wait: "[data-option-bar]", then: () => page.waitForSelector(".fixed button", { timeout: 10_000 }) });
  }
  await visit(page, studioUrl({ v, e: MAIN, opt: "new" }), "new-option dialog", { wait: "[data-option-name]" });
  await visit(page, studioUrl({ e: MAIN, cmp: v }), "compare with another version", { wait: "iframe" });
  await visit(page, `${STUDIO}/versions`, "/versions", { wait: "[data-version-row]" });
  // The buttons of a version row (studio/src/i18n/history.ts newFromHere, editVersion, setLive), on the throwaway
  // version's row (not live: it has "Set as live"). Each dialog is read, then left without confirming.
  const versionsDialog = (state, test) => visit(page, `${STUDIO}/versions`, state, {
    wait: "[data-version-row]",
    then: async () => {
      const clicked = await page.evaluate((id, t) => {
        const b = [...document.querySelectorAll(`[data-version-row="${id}"] button`)].find((x) => (t.label ? x.getAttribute("aria-label")?.startsWith(t.label) : x.textContent.trim() === t.text));
        b?.click();
        return !!b;
      }, v, test);
      ok(clicked, `${state} opens`);
      await page.waitForSelector(".fixed", { timeout: 10_000 });
    },
  });
  await versionsDialog("/versions: new version dialog", { text: "New version from here" });
  await versionsDialog("/versions: edit dialog", { label: "Edit " });
  await versionsDialog("/versions: set-live dialog", { text: "Set as live" });
  for (const k of ["behavior", "tech"]) await visit(page, `${STUDIO}/spec?e=${encodeURIComponent(MAIN)}&k=${k}`, `/spec ${k}`, { wait: "[data-spec-page]" });
  await visit(page, `${STUDIO}/spec?e=${encodeURIComponent(MAIN)}&k=behavior&p=all`, "/spec all pages", { wait: "[data-spec-page]" });
  await visit(page, `${STUDIO}/frame?e=${encodeURIComponent(MAIN)}&th=light`, "/frame");
  await visit(page, `${STUDIO}/frame?e=screens/nope&th=light`, "/frame of a missing board");
  await visit(page, `${STUDIO}/__src`, "/__src (no source declared)");
  await page.close();

  // ── Phone ──
  const m = await newPage(browser, PHONE);
  await visit(m, studioUrl({ e: MAIN }), "390: screen", { wait: "header" });
  await visit(m, studioUrl({ e: MAIN, nav: "1" }), "390: drawer with the language switch", { wait: "[data-sidebar-foot] select" });
  await visit(m, studioUrl({ e: MAIN, t: marks.id, panel: "1" }), "390: chat sheet", { wait: "div[data-panel] [data-composer]" });
  await visit(m, studioUrl({ e: MAIN, panel: "1", rp: "history" }), "390: history", { wait: "[data-rev]" });
  await visit(m, studioUrl({ e: MAIN, spec: "1" }), "390: spec sheet", { wait: "[data-spec-panel]" });
  await visit(m, studioUrl({ v, e: trying }), "390: option bar", { wait: "[data-option-bar]" });
  await m.close();

  // ── The reader itself: on the same thread in Vietnamese (ct_lang=vi) it must find the Vietnamese UI ──
  {
    const ctx = await browser.createBrowserContext();
    const vi = await newPage(ctx, DESKTOP);
    await vi.setCookie({ name: "ct_lang", value: "vi", url: STUDIO });
    await gotoReady(vi, studioUrl({ e: MAIN, t: marks.id }));
    await vi.waitForSelector("[data-panel] [data-composer]", { timeout: 30_000 });
    await sleep(400);
    const read = await vi.evaluate(readable, EXEMPT);
    const found = read.filter((x) => VIETNAMESE.test(x.text));
    const kinds = new Set(found.map((x) => x.kind));
    const has = (text) => found.some((x) => x.text === text);
    ok(found.length >= 20 && has("Gửi") && has("Hành vi") && kinds.has("aria-label") && kinds.has("title") && kinds.has("innerText"),
      `the reader catches Vietnamese: ${found.length} texts on the same thread with ct_lang=vi (text, aria-label, title, innerText; "Gửi", "Hành vi")`);
    ok(!read.some((x) => x.text === "Tiếng Việt") && (await vi.$(EXEMPT)) !== null, "the language switch's own \"Tiếng Việt\" option is the one text left out");
    await ctx.close();
  }

  const shown = hits.map((h) => `   ${h.state} · ${h.kind}: "${h.text.slice(0, 100)}" (${h.where})`);
  ok(hits.length === 0, `${states} pages and states read in English, no Vietnamese text${hits.length ? `:\n${shown.join("\n")}` : ""}`);
  ok(errors.length === 0, `no script errors${errors.length ? `: ${errors.slice(0, 5).join(" | ")}` : ""}`);
});
