// e2e: the board list (the sidebar on the left) resizes like the conversation panel.
//   • 224 px by default; dragging its right edge 150 px right makes it 374, the board column gives the room back
//   • a reload keeps the width (each person's own, stored on this machine); a double-click goes back to 224
//   • the arrow keys step 24 px; it never gets narrower than 180 nor wider than 40% of the screen (512 at 1280)
//   • the conversation panel on the right still drags (both edges share one handle code)
//   • the console stays clean. (Each run's Chrome has a fresh profile: the stored widths do not outlive it.)
// Screenshot: tests/shots/nav-resize-1280.png
import { DESKTOP, gotoReady, newPage, ok, run, shot, sleep, studioUrl } from "./lib/e2e.mjs";
import { PANEL_DEFAULT, SIDEBAR_DEFAULT, SIDEBAR_MIN } from "../studio/lib/panel-width.mjs";

const A = "screens/tasks/list";
const width = (page, sel) => page.$eval(sel, (el) => Math.round(el.getBoundingClientRect().width));
const grip = (page, sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 300 }; });
async function dragBy(page, sel, dx) {
  const g = await grip(page, sel);
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  await page.mouse.move(g.x + dx / 2, g.y, { steps: 6 });
  await page.mouse.move(g.x + dx, g.y, { steps: 6 });
  await page.mouse.up();
  await sleep(250);
}
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

await run("nav-resize", async ({ browser }) => {
  const problems = [];
  const watch = (p) => {
    p.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error" && !/WebSocket|Failed to load resource|favicon/.test(m.text())) problems.push(`console: ${m.text()}`); });
  };
  const page = await newPage(browser, DESKTOP);
  watch(page);
  await gotoReady(page, studioUrl({ e: A }));
  await page.waitForSelector("[data-sidebar-resize]", { timeout: 15_000 });

  // ── Drag wider; the board column gives the room back ──
  const w0 = await width(page, "[data-sidebar]");
  ok(w0 === SIDEBAR_DEFAULT, `the board list is ${SIDEBAR_DEFAULT} px by default (${w0})`);
  const mainX0 = await page.$eval("header", (el) => Math.round(el.getBoundingClientRect().x));
  await dragBy(page, "[data-sidebar-resize]", 150);
  const w1 = await width(page, "[data-sidebar]");
  ok(Math.abs(w1 - (SIDEBAR_DEFAULT + 150)) <= 2, `dragged 150 px right → ${SIDEBAR_DEFAULT + 150} (${w1})`);
  const mainX1 = await page.$eval("header", (el) => Math.round(el.getBoundingClientRect().x));
  ok(Math.abs(mainX1 - mainX0 - 150) <= 2, `the board column starts 150 px further right (${mainX0} → ${mainX1})`);
  ok(Number(await stored(page, "studio:navWidth")) === w1, "the width is stored for this person");
  await shot(page, "nav-resize-1280");

  // ── A reload keeps it; a double-click resets ──
  const p2 = await newPage(browser, DESKTOP); // same browser profile: the stored width carries over
  watch(p2);
  await gotoReady(p2, studioUrl({ e: A }));
  await p2.waitForSelector("[data-sidebar-resize]", { timeout: 15_000 });
  const w2 = await width(p2, "[data-sidebar]");
  ok(Math.abs(w2 - w1) <= 2, `a reload keeps ${w1} (${w2})`);
  const g = await grip(p2, "[data-sidebar-resize]");
  await p2.mouse.click(g.x, g.y, { count: 2 });
  await sleep(250);
  ok(await width(p2, "[data-sidebar]") === SIDEBAR_DEFAULT, `double-click → back to ${SIDEBAR_DEFAULT}`);

  // ── Keys, and the limits ──
  await p2.focus("[data-sidebar-resize]");
  await p2.keyboard.press("ArrowRight");
  await sleep(150);
  ok(await width(p2, "[data-sidebar]") === SIDEBAR_DEFAULT + 24, "→ widens by 24 px");
  await p2.keyboard.press("ArrowLeft");
  await sleep(150);
  ok(await width(p2, "[data-sidebar]") === SIDEBAR_DEFAULT, "← narrows by 24 px");
  await dragBy(p2, "[data-sidebar-resize]", -400);
  ok(await width(p2, "[data-sidebar]") === SIDEBAR_MIN, `never narrower than ${SIDEBAR_MIN}`);
  await dragBy(p2, "[data-sidebar-resize]", 900);
  const wMax = await width(p2, "[data-sidebar]");
  ok(wMax === Math.round(DESKTOP.width * 0.4), `never wider than 40% of the screen (${wMax})`);
  await p2.mouse.click((await grip(p2, "[data-sidebar-resize]")).x, 300, { count: 2 });
  await sleep(250);

  // ── The conversation panel still drags ──
  const pw0 = await width(p2, "[data-panel]");
  ok(pw0 === PANEL_DEFAULT, `the conversation panel is ${PANEL_DEFAULT} (${pw0})`);
  await dragBy(p2, "[data-panel-resize]", -100);
  ok(Math.abs(await width(p2, "[data-panel]") - (PANEL_DEFAULT + 100)) <= 2, `the conversation panel drags wider (${PANEL_DEFAULT + 100})`);
  const pg = await grip(p2, "[data-panel-resize]");
  await p2.mouse.click(pg.x, pg.y, { count: 2 });
  await sleep(250);
  ok(await width(p2, "[data-panel]") === PANEL_DEFAULT, "double-click puts it back");
  await p2.close();

  ok(problems.length === 0, `console clean${problems.length ? `: ${problems.slice(0, 3).join(" | ")}` : ""}`);
  await page.close();
});
