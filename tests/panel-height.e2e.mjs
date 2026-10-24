// e2e: a LONG thread never makes the right panel taller than the screen (once, scrolling the spec editor to its end
// pushed the whole page up by 44px; on phones the Annotate / Image / Send row fell below the edge).
//   • 1280: the page is no taller than the window; wheel-scrolling the spec editor to its end does NOT scroll the
//     page; the Send button stays on screen
//   • 390 (chat sheet): the Send button stays on screen
// Thread created with noAgent (no Claude), deleted at the end. Screenshots: tests/shots/panel-height-*.png
import { DESKTOP, PHONE, UI, api, newPage, ok, run, shot, sleep, studioUrl } from "./lib/e2e.mjs";

const ENTRY = "screens/tasks/list";
// Bottom edge of the composer's Send button (not "Ask Claude to answer" inside the thread).
const sendBottom = (page) => page.evaluate((label) => {
  const b = [...document.querySelectorAll("[data-panel] [data-composer] button")].find((x) => x.textContent.trim() === label && x.getBoundingClientRect().width > 0);
  return Math.round(b.getBoundingClientRect().bottom);
}, UI.send);

await run("panel-height", async ({ browser, cleanup }) => {
  const long = "A long thread, so the chat panel has to scroll inside instead of pushing the whole page. ".repeat(6);
  const { thread } = await api("POST", "/__api/threads", { entry: ENTRY, text: long, noAgent: true });
  cleanup("thread", () => api("DELETE", `/__api/threads/${thread.id}`));
  for (let i = 0; i < 12; i++) await api("POST", `/__api/threads/${thread.id}/messages`, { text: `${i + 1}. ${long}`, noAgent: true });

  // ── Desktop: spec editor + long thread ──
  const page = await newPage(browser, DESKTOP);
  await page.goto(studioUrl({ e: ENTRY, spe: 1, t: thread.id }), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".cm-line").length > 5 && document.querySelector("[data-panel] [data-composer] textarea"));
  await sleep(1200);
  const docH = await page.evaluate(() => document.scrollingElement.scrollHeight);
  ok(docH <= DESKTOP.height, `1280: the page is no taller than the window (${docH}px / ${DESKTOP.height}px)`);
  ok((await sendBottom(page)) <= DESKTOP.height, "1280: the Send button is on screen");
  const box = await (await page.$(".cm-scroller")).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 15; i++) { await page.mouse.wheel({ deltaY: 600 }); await sleep(80); }
  await sleep(600);
  const after = await page.evaluate(() => ({ y: scrollY, cm: document.querySelector(".cm-scroller").scrollTop }));
  ok(after.cm > 0 && after.y === 0, `1280: the spec editor scrolls to its end (${after.cm}px), the page does not move (scrollY ${after.y})`);
  await shot(page, "panel-height-1280");
  await page.close();

  // ── Phone: chat sheet ──
  const m = await newPage(browser, PHONE);
  await m.goto(studioUrl({ e: ENTRY, panel: 1, t: thread.id }), { waitUntil: "domcontentloaded" });
  await m.waitForSelector("div[data-panel] [data-composer] textarea");
  await sleep(1200);
  const sb = await sendBottom(m);
  ok(sb <= PHONE.height, `390: the Send button is on screen (${sb}px / ${PHONE.height}px)`);
  await shot(m, "panel-height-390");
  await m.close();
});
