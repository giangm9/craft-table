// e2e: the "Whole design" tab — a conversation that belongs to the version, not to one screen.
//   • the tab is there, selected by ?rp=design; with no thread it says what the tab is for; it never shows the screen threads
//   • a message typed there and sent creates a thread with entry "*" and the screen being looked at as `viewing`
//     (the send is made with the studio's noAgent switch on — nothing reaches Claude)
//   • the same thread is in the list on ANOTHER screen, and the screen's own Conversation tab does not list it
//   • there is no Mark button in this tab; a message sent while looking at another screen says which one
//   • a whole-design turn that is running makes every screen say Claude is editing it
//   • it is still there after a reload; the browser console stays clean the whole time
// Screenshot: tests/shots/design-chat-1280.png
import fs from "node:fs";
import { DESKTOP, UI, api, gotoReady, newPage, ok, projectFile, run, shot, sleep, studioUrl, until } from "./lib/e2e.mjs";

const A = "screens/tasks/list", B = "screens/tasks/detail";
const DESIGN_TAB = "[role=tab][aria-selected=true]";

await run("design-chat", async ({ browser, cleanup }) => {
  const problems = [];
  const page = await newPage(browser, DESKTOP);
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|Failed to load resource|favicon/.test(m.text())) problems.push(`console: ${m.text()}`); });
  // Sends are made with noAgent on: the thread is real, but no Claude turn starts.
  await page.setRequestInterception(true);
  const created = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/__api/threads")) {
      const body = JSON.parse(r.postData() ?? "{}");
      created.push(body);
      return r.continue({ postData: JSON.stringify({ ...body, noAgent: true }) });
    }
    return r.continue();
  });

  // ── The tab, empty ──
  await gotoReady(page, studioUrl({ e: A, rp: "design" }));
  const tab = await page.waitForSelector(DESIGN_TAB, { timeout: 10_000 }).then((h) => h.evaluate((el) => el.textContent.trim()));
  ok(tab.includes(UI.design), `the selected tab is "${UI.design}" (${tab})`);
  await page.waitForFunction((t) => document.querySelector("[data-panel]")?.textContent.includes(t), { timeout: 10_000 }, UI.noDesignThreads);
  ok(true, `an empty tab says what it is for: "${UI.noDesignThreads.slice(0, 40)}…"`);

  // ── Start a thread from the UI ──
  await page.evaluate((t) => [...document.querySelectorAll("[data-panel] button")].find((b) => b.textContent.includes(t))?.click(), UI.newThread);
  const ta = "[data-panel] [data-composer] textarea";
  await page.waitForSelector(ta, { timeout: 10_000 });
  const markButtons = await page.evaluate((t) => [...document.querySelectorAll("[data-panel] [data-composer] button")].filter((b) => b.textContent.includes(t)).length, UI.mark);
  ok(markButtons === 0, `no "${UI.mark}" button in the whole-design composer (${markButtons})`);
  await page.type(ta, "E2E design chat: make everything a little tighter");
  await page.keyboard.press("Enter");
  await until(() => created.length === 1, "the thread was created");
  ok(created[0].entry === "*", `the thread belongs to the version: entry "*" (${created[0].entry})`);
  ok(created[0].viewing === A, `the screen being looked at is sent as viewing (${created[0].viewing})`);
  const list = (await api("GET", "/__api/threads?entry=*")).threads.filter((t) => t.title.startsWith("E2E design chat"));
  ok(list.length === 1, "the server lists it as a design thread");
  const thread = list[0];
  cleanup(`thread ${thread.id}`, () => api("DELETE", `/__api/threads/${thread.id}`));
  ok(thread.messages[0].viewing == null || thread.messages[0].viewing === A, "the first message is stored");

  // ── It is version-wide: on another screen, in the same tab ──
  await gotoReady(page, studioUrl({ e: B, rp: "design" }));
  await page.waitForFunction((t) => [...document.querySelectorAll("[data-panel] button")].some((b) => b.textContent.includes(t)), { timeout: 10_000 }, "E2E design chat");
  ok(true, "the thread is listed on another screen's whole-design tab");
  const onScreenTab = await (async () => {
    await gotoReady(page, studioUrl({ e: B }));
    await sleep(600);
    return page.evaluate(() => document.querySelector("[data-panel]")?.textContent.includes("E2E design chat"));
  })();
  ok(onScreenTab === false, "the screen's own Conversation tab does not list it");

  // ── A message sent while looking at another screen says which one ──
  await api("POST", `/__api/threads/${thread.id}/messages`, { text: "and this one too", refs: [], viewing: B, noAgent: true });
  await gotoReady(page, studioUrl({ e: A, rp: "design", dt: thread.id }));
  await page.waitForSelector("[data-message-on]", { timeout: 10_000 });
  const label = await page.$eval("[data-message-on]", (el) => el.textContent);
  ok(/Task detail|detail/i.test(label) && label.includes(UI.lookingAt), `the message says it was sent while looking at another screen: "${label.trim()}"`);
  await shot(page, "design-chat-1280");

  // ── A running whole-design turn: every screen says Claude is editing ──
  const file = projectFile("threads", `${thread.id}.json`);
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  j.agent = { ...j.agent, state: "running", progress: { key: "browsing", params: { what: "all" } } };
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
  await gotoReady(page, studioUrl({ e: B, rp: "design", dt: thread.id }));
  const busyHere = await page.waitForFunction((t) => document.querySelector("[data-claude-busy]")?.textContent.includes(t), { timeout: 10_000, polling: 150 }, UI.claudeBusy).then(() => true, () => false);
  ok(busyHere, `another screen says "${UI.claudeBusy}" while the whole-design turn runs`);
  j.agent = { ...j.agent, state: "idle", progress: null };
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");

  // ── Reload: still there ──
  await gotoReady(page, studioUrl({ e: A, rp: "design" }));
  await page.waitForFunction((t) => [...document.querySelectorAll("[data-panel] button")].some((b) => b.textContent.includes(t)), { timeout: 10_000 }, "E2E design chat");
  ok(true, "after a reload the thread is still in the tab");

  ok(problems.length === 0, `the browser console stayed clean (${problems.slice(0, 3).join(" | ")})`);
});
