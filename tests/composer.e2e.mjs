// e2e: the message composer of a thread.
//   • small box: Shift+Enter makes a new line, Enter sends
//   • big composer (expand button): centred and large; Enter makes a new line, Ctrl+Enter sends and folds it back;
//     the URL says soan=1 while it is open
//   • Esc folds the big composer and keeps what was typed
//   • phone 390: the big composer fills the screen
// Sending is intercepted in the browser (answered with the thread as it is) — nothing reaches Claude.
// Screenshots: tests/shots/composer-*.png
import { DESKTOP, PHONE, UI, api, newPage, ok, run, shot, sleep, studioUrl } from "./lib/e2e.mjs";

const ENTRY = "screens/tasks/list";

await run("composer", async ({ browser, cleanup }) => {
  const { thread } = await api("POST", "/__api/threads", { entry: ENTRY, text: "Composer test", noAgent: true });
  cleanup("thread", () => api("DELETE", `/__api/threads/${thread.id}`));
  const sent = [];
  const fake = async (page) => {
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith(`/__api/threads/${thread.id}/messages`)) {
        sent.push(JSON.parse(r.postData() ?? "{}").text);
        return r.respond({ status: 201, contentType: "application/json", body: JSON.stringify({ thread }) });
      }
      return r.continue();
    });
  };
  const ta = "[data-panel] [data-composer] textarea";
  const big = "[data-composer-lon] textarea";
  const value = (page, sel = ta) => page.$eval(sel, (el) => el.value);

  const page = await newPage(browser, DESKTOP);
  await fake(page);
  await page.goto(studioUrl({ e: ENTRY, t: thread.id }), { waitUntil: "load" });
  await page.waitForSelector(ta);
  await sleep(800);

  // ── Small box ──
  await page.click(ta);
  await page.type(ta, "line 1");
  await page.keyboard.down("Shift"); await page.keyboard.press("Enter"); await page.keyboard.up("Shift");
  await page.type(ta, "line 2");
  ok((await value(page)) === "line 1\nline 2" && sent.length === 0, "Shift+Enter makes a new line and sends nothing");
  await page.keyboard.press("Enter");
  await sleep(500);
  ok(sent.length === 1 && sent[0] === "line 1\nline 2", `Enter sends the text (${JSON.stringify(sent[0])})`);
  ok((await value(page)) === "", "the box is empty after sending");

  // ── Big composer ──
  await page.type(ta, "opening");
  await page.click(`[data-panel] button[aria-label="${UI.openBigComposer}"]`);
  await page.waitForSelector(big);
  ok(new URL(page.url()).searchParams.get("soan") === "1", "the URL has soan=1");
  const box = await page.$eval("[data-composer-lon]", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, w: r.width, h: r.height }; });
  ok(box.w >= 700 && box.h >= 600 && Math.abs(box.x + box.w / 2 - DESKTOP.width / 2) < 4, `big composer centred, ${Math.round(box.w)}×${Math.round(box.h)}`);
  ok((await value(page, big)) === "opening", "the text typed so far moves into the big composer");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second paragraph");
  ok((await value(page, big)) === "opening\nsecond paragraph" && sent.length === 1, "big composer: Enter makes a new line, sends nothing");
  await shot(page, "composer-1280-big");
  await page.keyboard.down("Control"); await page.keyboard.press("Enter"); await page.keyboard.up("Control");
  await sleep(600);
  ok(sent.length === 2 && sent[1] === "opening\nsecond paragraph", "Ctrl+Enter sends");
  ok(!(await page.$("[data-composer-lon]")) && !new URL(page.url()).searchParams.get("soan"), "after sending the big composer folds back");

  // ── Esc folds the big composer, the text stays ──
  await page.click(`[data-panel] button[aria-label="${UI.openBigComposer}"]`);
  await page.waitForSelector(big);
  await page.keyboard.type("not sent yet");
  await page.keyboard.press("Escape");
  await sleep(300);
  ok(!(await page.$("[data-composer-lon]")), "Esc folds the big composer");
  ok((await value(page)) === "not sent yet" && sent.length === 2, "the typed text is still there, nothing sent");
  await shot(page, "composer-1280-small");
  await page.close();

  // ── Phone 390: the big composer fills the screen ──
  const m = await newPage(browser, PHONE);
  await fake(m);
  await m.goto(studioUrl({ e: ENTRY, t: thread.id, panel: 1, soan: 1 }), { waitUntil: "load" });
  // A phone has two copies of the panel (the hidden desktop one + the sheet) → use the big composer that is shown.
  const shown = () => [...document.querySelectorAll("[data-composer-lon]")].find((el) => el.getBoundingClientRect().width > 0);
  await m.waitForFunction(shown);
  await sleep(800);
  const mta = await m.evaluateHandle(() => [...document.querySelectorAll("[data-composer-lon] textarea")].find((el) => el.getBoundingClientRect().width > 0));
  await mta.type("A long text typed on a phone");
  const mb = await m.evaluate(() => { const r = [...document.querySelectorAll("[data-composer-lon]")].find((x) => x.getBoundingClientRect().width > 0).getBoundingClientRect(); return { w: r.width, h: r.height }; });
  ok(mb.w === PHONE.width && mb.h >= 700, `390: the big composer fills the screen (${mb.w}×${mb.h})`);
  await shot(m, "composer-390-big");
  await m.close();
});
