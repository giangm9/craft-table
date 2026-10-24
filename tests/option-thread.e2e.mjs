// e2e: a screen and its options share threads.
//   • a thread open on the main screen → pick the option in the screen list → the thread stays open; back to the
//     main screen → still open
//   • a message sent while looking at the option records the screen being viewed (viewing) — the send is
//     intercepted, nothing reaches Claude
//   • an annotation drawn on the option is not shown on the main screen's frames; its chip switches to the option
// The option is created through the API and removed at the end, like the thread. Screenshots: tests/shots/optthread-*.png
import { DESKTOP, PHONE, UI, api, entries, newPage, ok, run, shot, sleep, studioUrl } from "./lib/e2e.mjs";

const MAIN = "screens/tasks/list";
const NAME = "Compact rows";
const param = (page, k) => new URL(page.url()).searchParams.get(k);

await run("option-thread", async ({ browser, cleanup }) => {
  const scenario = (await entries()).find((e) => e.id === MAIN).meta.scenarios[0].id;
  const opt = (await api("POST", "/__api/options", { entries: [MAIN], name: NAME })).ids[0];
  cleanup("option", () => api("POST", "/__api/options/remove", { entry: opt }));
  const { thread } = await api("POST", "/__api/threads", { entry: MAIN, text: "About the row height", noAgent: true });
  cleanup("thread", () => api("DELETE", `/__api/threads/${thread.id}`));
  // An annotation drawn on the option (message sent while looking at it).
  const withRef = await api("POST", `/__api/threads/${thread.id}/messages`, { text: "this row [#1]", noAgent: true, viewing: opt, refs: [{ scenario, viewport: "desktop", rect: { x: 300, y: 140, w: 160, h: 40 }, texts: [], entry: opt }] });
  const refKey = `${withRef.thread.messages.at(-1).id}:0`;

  const page = await newPage(browser, DESKTOP);
  const sent = [];
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith(`/__api/threads/${thread.id}/messages`)) {
      sent.push(JSON.parse(r.postData() ?? "{}"));
      return r.respond({ status: 201, contentType: "application/json", body: JSON.stringify({ thread: withRef.thread }) });
    }
    return r.continue();
  });
  await page.goto(studioUrl({ e: MAIN, t: thread.id }), { waitUntil: "load" });
  await page.waitForSelector("[data-panel] [data-composer] textarea");
  await sleep(1500);
  ok(await page.$eval("[data-panel]", (el) => el.textContent.includes("About the row height")), "main screen: the thread is open");
  ok((await page.$$(`[data-ref="${refKey}"]`)).length === 0, "an annotation drawn on the option is NOT shown on the main screen's frames");
  ok(await page.$eval("[data-message-on]", (el, name) => el.textContent.includes(name), NAME), `the message says it was sent on option "${NAME}"`);

  // Pick the option in the screen list → the thread stays open.
  await page.click(`a[href="?e=${encodeURIComponent(opt)}"]`);
  await page.waitForFunction((id) => new URL(location.href).searchParams.get("e") === id, {}, opt);
  await sleep(1200);
  ok(param(page, "t") === thread.id, "on the option: the thread stays open (t unchanged)");
  ok(await page.$eval("[data-panel]", (el) => el.textContent.includes("About the row height")), "on the option: the thread's messages are shown");
  await page.waitForSelector(`[data-ref="${refKey}"]`, { timeout: 30_000 });
  ok(true, "the annotation's marker shows on the option's frame");
  await shot(page, "optthread-1280-option");

  // Send while looking at the option → records viewing.
  const ta = "[data-panel] [data-composer] textarea";
  await page.click(ta);
  await page.type(ta, "make the rows shorter");
  await page.keyboard.press("Enter");
  await sleep(600);
  ok(sent.length === 1 && sent[0].viewing === opt, `the message carries the screen being viewed (${sent[0]?.viewing})`);

  // Back to the main screen through the option bar → still open; the annotation chip → switches to the option.
  await page.click("[data-option-bar] p button.underline");
  await page.waitForFunction((id) => new URL(location.href).searchParams.get("e") === id, {}, MAIN);
  await sleep(1200);
  ok(param(page, "t") === thread.id, "back on the main screen: the thread stays open");
  await shot(page, "optthread-1280-main");
  await page.evaluate(() => { [...document.querySelectorAll("[data-panel] button")].find((x) => x.textContent === "#1")?.click(); });
  await page.waitForFunction((id) => new URL(location.href).searchParams.get("e") === id, { timeout: 15_000 }, opt);
  ok(param(page, "rf") === refKey && param(page, "t") === thread.id, "the chip of an annotation drawn on the option switches to the option and keeps the thread");

  // Thread list on the option: the main screen's thread is labelled.
  await page.click(`[data-panel] button[aria-label="${UI.backToThreads}"]`);
  await page.waitForSelector("[data-thread-on]");
  ok(await page.$eval("[data-thread-on]", (el, label) => el.textContent.includes(label), UI.mainScreen), `thread list on the option: the main screen's thread says "${UI.mainScreen}"`);
  await shot(page, "optthread-1280-list");
  await page.close();

  const m = await newPage(browser, PHONE);
  await m.goto(studioUrl({ e: opt, t: thread.id, panel: 1 }), { waitUntil: "load" });
  await m.waitForFunction(() => [...document.querySelectorAll("[data-panel]")].some((el) => el.getBoundingClientRect().width > 0 && el.textContent.includes("About the row height")));
  await sleep(800);
  ok(true, "390: the option's chat sheet shows the shared thread");
  await shot(m, "optthread-390-option");
  await m.close();
});
