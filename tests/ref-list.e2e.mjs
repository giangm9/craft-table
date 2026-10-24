// e2e: the list of annotations (marks) of a thread — remove, restore, redraw.
//   • SENT annotations: the list button in the thread header (URL kh=1) → remove one (chip struck through, its marker
//     leaves the canvas, the server records "removed") → restore it → "Redraw" #2 and drag on the canvas → the server
//     replaces the region, records "redrawn", keeps the number
//   • PENDING annotations (being composed): remove +1 → the text "[#1] [#2]" becomes "[#1]" (later numbers shift)
//     → redraw +1 replaces its region without adding one
//   • phone 390: the list sits in the chat sheet; "Redraw" closes the sheet so you can draw, the toolbar says so
// Thread created with noAgent (no Claude), deleted at the end. Screenshots: tests/shots/ref-list-*.png
import { DESKTOP, PHONE, UI, api, entries, newPage, ok, run, shot, sleep, studioUrl, until } from "./lib/e2e.mjs";

const ENTRY = "screens/tasks/list";
const R1 = { scenario: null, viewport: "desktop", rect: { x: 20, y: 20, w: 200, h: 60 }, texts: ["one"] };
const R2 = { scenario: null, viewport: "desktop", rect: { x: 300, y: 120, w: 160, h: 50 }, texts: ["two"] };

await run("ref-list", async ({ browser, cleanup }) => {
  // An annotation without a scenario sits in the first scenario's row → the list names that scenario.
  const firstScenario = (await entries()).find((e) => e.id === ENTRY).meta.scenarios[0].title;
  const t = (await api("POST", "/__api/threads", { entry: ENTRY, text: "this button [#1] this text [#2]", refs: [R1, R2], noAgent: true })).thread;
  cleanup("thread", () => api("DELETE", `/__api/threads/${t.id}`));
  const mid = t.messages[0].id;
  const serverRefs = async () => (await api("GET", `/__api/threads/${t.id}`)).thread.messages[0].refs;

  const page = await newPage(browser, DESKTOP);
  await page.goto(studioUrl({ e: ENTRY, t: t.id }), { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-panel] [data-refs-toggle]");
  await page.waitForFunction(() => document.querySelectorAll("iframe").length > 0);
  await sleep(1500);
  const rows = (sel = "[data-panel] [data-ref-list] [data-ref-row]") => page.$$(sel);
  const marker = (k) => page.$(`[data-ref="${k}"]`);
  const toolbar = () => page.evaluate((title) => [...document.querySelectorAll("button")].find((b) => b.title.startsWith(title))?.textContent.trim(), UI.annotateTitle);
  // Drag on the first frame (desktop, first scenario) — position as a share of the frame as shown on screen.
  const drawOnFrame = async (fx, fy) => {
    const r = await page.$eval("iframe", (f) => { const b = f.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    const x0 = r.x + r.w * fx, y0 = r.y + r.h * fy;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + r.w * 0.2, y0 + r.h * 0.15, { steps: 8 });
    await page.mouse.up();
    await sleep(500);
  };

  // ── Sent annotations ──
  await page.click("[data-panel] [data-refs-toggle]");
  await page.waitForSelector("[data-panel] [data-ref-list]");
  ok((await rows()).length === 2 && page.url().includes("kh=1"), "1280: the thread's annotation list opens (2 annotations, URL kh=1)");
  ok(!!(await marker(`${mid}:0`)) && !!(await marker(`${mid}:1`)), "1280: markers #1 and #2 on the canvas");
  const firstRow = await (await rows())[0].evaluate((r) => r.textContent);
  ok(!firstRow.includes("· ·") && firstRow.includes(firstScenario), `1280: an annotation without a scenario names the first scenario (${firstRow.slice(0, 60)}…)`);

  await (await (await rows())[0].$("[data-ref-remove]")).click();
  await until(async () => (await serverRefs())[0].removed, "the server records #1 as removed");
  await page.waitForSelector("[data-panel] [data-ref-list] [data-ref-restore]");
  ok(!(await marker(`${mid}:0`)) && !!(await marker(`${mid}:1`)), "1280: removing #1 takes its marker off the canvas, #2 stays");
  ok((await page.$$("[data-panel] [data-ref-chip='da-bo']")).length >= 2, "1280: chip #1 struck through in the message and in the list");
  ok((await rows()).length === 2, "1280: a removed annotation stays in the list (to restore it)");

  await page.click("[data-panel] [data-ref-list] [data-ref-restore]");
  await until(async () => !(await serverRefs())[0].removed, "the server restores #1");
  await until(async () => !!(await marker(`${mid}:0`)), "marker #1 comes back");
  ok(true, "1280: restoring #1 brings its marker back");

  await (await (await rows())[1].$("[data-ref-redraw]")).click();
  await sleep(300);
  ok((await toolbar()).startsWith(`${UI.redraw} #2`), `1280: Redraw #2 → the toolbar says "${await toolbar()}"`);
  await drawOnFrame(0.15, 0.35);
  await until(async () => (await serverRefs())[1].redrawn, "the server records #2 as redrawn");
  const after = await serverRefs();
  ok(JSON.stringify(after[1].rect) !== JSON.stringify(R2.rect) && JSON.stringify(after[0].rect) === JSON.stringify(R1.rect), `1280: #2 has a new region (${JSON.stringify(after[1].rect)}), #1 unchanged`);
  // In English the button's words share a prefix ("Mark" / "Marking"): mark mode is off when it does not say "Marking".
  const idle = await toolbar();
  ok(after.length === 2 && idle.startsWith(UI.annotate) && !idle.startsWith(UI.annotating), `1280: no annotation added; drawing ends annotate mode ("${idle}")`);
  await page.waitForFunction((label) => [...document.querySelectorAll("[data-panel] [data-ref-row]")].some((r) => r.textContent.includes(label)), {}, UI.redrawn);
  ok(true, "1280: row #2 says it was redrawn");
  await shot(page, "ref-list-1280-sent");

  // ── Pending annotations ──
  const ta = "[data-panel] [data-composer] textarea";
  const value = () => page.$eval(ta, (el) => el.value);
  const pending = () => rows("[data-panel] [data-pending-refs] [data-ref-row]");
  await page.click("[data-panel] [data-refs-toggle]"); // fold the thread's list
  await page.keyboard.press("c");
  await drawOnFrame(0.1, 0.55);
  await drawOnFrame(0.5, 0.55);
  await page.keyboard.press("Escape");
  ok((await pending()).length === 2 && (await value()).includes("[#1]") && (await value()).includes("[#2]"), `1280: 2 pending annotations, text "${await value()}"`);
  const p2Before = await page.$eval('[data-ref="pending:1"]', (el) => el.style.left);
  await (await (await pending())[0].$("[data-ref-remove]")).click();
  await sleep(300);
  ok((await pending()).length === 1 && (await value()).trim() === "[#1]", `1280: removing +1 leaves one, the text renumbers to "${(await value()).trim()}"`);
  ok((await page.$eval('[data-ref="pending:0"]', (el) => el.style.left)) === p2Before, "1280: the one left is the former +2 (now +1)");
  await (await (await pending())[0].$("[data-ref-redraw]")).click();
  await sleep(300);
  ok((await toolbar()).startsWith(`${UI.redraw} +1`), "1280: Redraw +1 → the toolbar says so");
  await drawOnFrame(0.3, 0.2);
  ok((await pending()).length === 1 && (await value()).trim() === "[#1]", "1280: redrawing +1 keeps one annotation, the text unchanged");
  ok((await page.$eval('[data-ref="pending:0"]', (el) => el.style.left)) !== p2Before, "1280: marker +1 moved to the new region");
  await shot(page, "ref-list-1280-pending");
  await page.close();

  // ── Phone ──
  const m = await newPage(browser, PHONE);
  await m.goto(studioUrl({ e: ENTRY, t: t.id, panel: 1, kh: 1 }), { waitUntil: "domcontentloaded" });
  await m.waitForSelector("div[data-panel] [data-ref-list] [data-ref-row]");
  await sleep(1200);
  const inView = await m.$$eval("div[data-panel] [data-ref-list] [data-ref-redraw], div[data-panel] [data-ref-list] [data-ref-remove]", (bs) => bs.every((b) => { const r = b.getBoundingClientRect(); return r.right <= innerWidth && r.width > 0; }));
  ok(inView, "390: Redraw / Remove buttons fit on the screen");
  await shot(m, "ref-list-390");
  await (await m.$("div[data-panel] [data-ref-list] [data-ref-redraw]")).tap();
  await sleep(600);
  const label = await m.evaluate((title) => [...document.querySelectorAll("button")].find((b) => b.title.startsWith(title))?.textContent.trim(), UI.annotateTitle);
  ok(!m.url().includes("panel=1") && label.startsWith(`${UI.redraw} #1`), `390: Redraw closes the chat sheet to draw, the toolbar says "${label}"`);
  await shot(m, "ref-list-390-redraw");
  await m.close();
});
