// e2e: the conversation panel can pop out as a floating window and be put back.
//   • docked: the side panel; its tab strip has the pop-out button
//   • pop out: the side panel is gone (the board gets the room), a window floats inside the browser window with its own
//     title bar; the text being typed is still in the box (nothing was remounted)
//   • drag the title bar → the window moves (and stays inside the window); drag the corner → it is resized
//   • a reload keeps it floating where it was; a smaller browser window pulls it back inside
//   • dock → the side panel is back, the floating window is gone, the draft is still there; the console stays clean
// Screenshots: tests/shots/float-panel-1280.png, float-panel-wide-1280.png (after the resize)
import { DESKTOP, UI, gotoReady, newPage, ok, run, shot, sleep, studioUrl, until } from "./lib/e2e.mjs";

const A = "screens/tasks/list";
const TA = "[data-panel] [data-composer] textarea";
const FLOAT = "[data-float-panel]";
const rect = (sel) => page_.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
let page_;

await run("float-panel", async ({ browser }) => {
  const problems = [];
  const page = (page_ = await newPage(browser, DESKTOP));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|Failed to load resource|favicon/.test(m.text())) problems.push(`console: ${m.text()}`); });
  await gotoReady(page, studioUrl({ e: A }));
  await page.evaluate(() => { localStorage.removeItem("studio:chatFloat"); localStorage.removeItem("studio:chatFloatRect"); }); // a clean start

  // ── Docked ──
  await gotoReady(page, studioUrl({ e: A, t: "new" }));
  await page.waitForSelector(TA, { timeout: 10_000 });
  ok((await page.$("aside[data-panel]")) !== null && (await page.$(FLOAT)) === null, "docked: the side panel is there, no floating window");
  const dockedCanvas = await rect("[data-canvas-bg]");
  await page.type(TA, "a draft that must survive");

  // ── Pop out ──
  await page.click("[data-panel] [data-panel-float]");
  await page.waitForSelector(FLOAT, { timeout: 5_000 });
  ok((await page.$("aside[data-panel]")) === null, "the side panel is gone");
  const floatCanvas = await rect("[data-canvas-bg]");
  ok(floatCanvas.w >= dockedCanvas.w + 300, `the board got the room (${dockedCanvas.w} → ${floatCanvas.w} px wide)`);
  let w = await rect(FLOAT);
  ok(w.x >= 0 && w.y >= 0 && w.x + w.w <= 1280 && w.y + w.h <= 800, `the window floats inside the browser window (${JSON.stringify(w)})`);
  ok((await page.$eval(TA, (el) => el.value)) === "a draft that must survive", "the text being typed is still in the box");
  await shot(page, "float-panel-1280");

  // ── Drag and resize ──
  const bar = await rect(`${FLOAT} [data-float-handle]`);
  await page.mouse.move(bar.x + 60, bar.y + 10);
  await page.mouse.down();
  await page.mouse.move(bar.x + 60 - 250, bar.y + 10 - 120, { steps: 8 });
  await page.mouse.up();
  const moved = await rect(FLOAT);
  ok(moved.x === w.x - 250 && moved.y === w.y - 120, `dragging the title bar moves the window (${w.x},${w.y} → ${moved.x},${moved.y})`);
  await page.mouse.move(moved.x + 30, moved.y + 10);
  await page.mouse.down();
  await page.mouse.move(-400, -400, { steps: 6 });
  await page.mouse.up();
  const pinned = await rect(FLOAT);
  ok(pinned.x === 0 && pinned.y === 0, `it cannot be dragged out of the browser window (${pinned.x},${pinned.y})`);
  const grip = await rect(`${FLOAT} [data-float-resize]`);
  await page.mouse.move(grip.x + grip.w / 2, grip.y + grip.h / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.w / 2 + 100, grip.y + grip.h / 2 + 60, { steps: 6 });
  await page.mouse.up();
  let grown = await rect(FLOAT);
  ok(grown.w === pinned.w + 100 && grown.h === pinned.h + 60, `dragging the corner resizes it (${pinned.w}×${pinned.h} → ${grown.w}×${grown.h})`);
  // The tool row of the message box is ONE line even in a narrow window: every control on the same line as Send.
  const oneLine = () => page.evaluate(() => {
    const tops = [...document.querySelectorAll("[data-float-panel] [data-composer-tools] > button, [data-float-panel] [data-run-chip]")].map((el) => Math.round(el.getBoundingClientRect().top));
    return { n: tops.length, spread: Math.max(...tops) - Math.min(...tops) };
  });
  const narrowRow = await oneLine();
  ok(narrowRow.n >= 5 && narrowRow.spread <= 1, `the tool row is one line in a ${pinned.w + 100} px window (${narrowRow.n} controls, ${narrowRow.spread} px apart)`);
  await shot(page, "float-panel-wide-1280");
  grown = await rect(FLOAT);

  // ── Reload and a smaller browser window ──
  await gotoReady(page, studioUrl({ e: A }));
  await page.waitForSelector(FLOAT, { timeout: 10_000 });
  const again = await rect(FLOAT);
  ok(JSON.stringify(again) === JSON.stringify(grown), `after a reload it floats where it was (${JSON.stringify(again)})`);
  await page.setViewport({ width: 1100, height: 640 });
  await sleep(300);
  const small = await rect(FLOAT);
  ok(small.x + small.w <= 1100 && small.y + small.h <= 640, `a smaller browser window pulls it back inside (${JSON.stringify(small)})`);
  await page.setViewport(DESKTOP);
  await sleep(200);

  // ── Dock ──
  await page.evaluate((t) => [...document.querySelectorAll("[data-float-panel] button")].find((b) => b.textContent.includes(t))?.click(), UI.newThread);
  await page.waitForSelector(TA, { timeout: 10_000 });
  await page.type(TA, "a second draft");
  await page.click(`${FLOAT} [data-panel-dock]`);
  await until(async () => (await page.$(FLOAT)) === null, "the window went away");
  ok((await page.$("aside[data-panel]")) !== null, "docked again: the side panel is back");
  ok((await page.$eval(TA, (el) => el.value)) === "a second draft", "and the draft typed in the window is still in the box");
  await gotoReady(page, studioUrl({ e: A, t: "new" }));
  await page.waitForSelector(TA, { timeout: 10_000 });
  ok((await page.$(FLOAT)) === null, "and it stays docked after a reload");
  ok(problems.length === 0, `the browser console stayed clean (${problems.slice(0, 3).join(" | ")})`);
});
