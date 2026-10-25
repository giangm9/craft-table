// e2e: conversations are GLOBAL — they belong to the version, not to a screen — and a screen is named inside the message.
//   • the right panel has Conversation and History only; the Conversation list is the same on every screen
//   • a thread from before (made on one screen) is in the same list, labelled with its screen, and still opens
//   • typing "@" in the composer opens a menu of the screens; Enter (or a click) writes @[screen-id]; the "@" button opens it too
//   • a message sent creates a thread with entry "*" and the screen being looked at as `viewing` (the send is made with
//     the studio's noAgent switch on — nothing reaches Claude)
//   • the mention is shown as a link with the screen's title; clicking it goes to that screen and the conversation STAYS open
//   • a message sent while looking at another screen says which one; there is a Mark button
//   • a running turn makes every screen say Claude is editing it; a reload keeps everything; the console stays clean
// Screenshots: tests/shots/global-chat-1280.png, global-chat-badge-1280.png
import fs from "node:fs";
import { DESKTOP, UI, api, gotoReady, newPage, ok, projectFile, run, shot, sleep, studioUrl, until } from "./lib/e2e.mjs";

const A = "screens/tasks/list", B = "screens/tasks/detail";
const PANEL = "[data-panel]";
const TA = `${PANEL} [data-composer] textarea`;

await run("global-chat", async ({ browser, cleanup }) => {
  const problems = [];
  const page = await newPage(browser, DESKTOP);
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|Failed to load resource|favicon/.test(m.text())) problems.push(`console: ${m.text()}`); });
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
  const panelHas = (text) => page.waitForFunction((s, t) => document.querySelector(s)?.textContent.includes(t), { timeout: 10_000 }, PANEL, text);
  const clickPanel = (text) => page.evaluate((s, t) => [...document.querySelectorAll(`${s} button`)].find((b) => b.textContent.includes(t))?.click(), PANEL, text);

  // Whatever the page creates is removed at the end, even when a check fails first (queued before anything is sent).
  cleanup("conversations made by the page", async () => {
    for (const t of (await api("GET", `/__api/threads?entry=${encodeURIComponent("*")}`)).threads) {
      if (t.messages[0]?.text.startsWith("make @[")) await api("DELETE", `/__api/threads/${t.id}`);
    }
  });
  // A thread from before: made on one screen.
  const { thread: legacy } = await api("POST", "/__api/threads", { entry: A, title: "E2E legacy screen thread", text: "an old thread of the task list", refs: [], noAgent: true });
  cleanup(`thread ${legacy.id}`, () => api("DELETE", `/__api/threads/${legacy.id}`));

  // ── The panel: two tabs, a list that is the same on every screen ──
  await gotoReady(page, studioUrl({ e: B }));
  await panelHas("E2E legacy screen thread");
  const tabs = await page.$$eval(`${PANEL} [role=tab]`, (els) => els.map((e) => e.textContent.trim()));
  ok(tabs.length === 2 && tabs[0].includes(UI.conversation) && tabs[1].includes(UI.history), `the panel has Conversation and History only (${tabs.join(" | ")})`);
  const label = await page.$eval(`${PANEL} [data-thread-on]`, (el) => el.textContent);
  ok(label.includes("Task list"), `a thread made on another screen is in the list, labelled with its screen ("${label.trim()}")`);

  // ── Start a conversation, mention a screen with "@" ──
  await page.evaluate((s, t) => [...document.querySelectorAll(`${s} button`)].find((b) => b.textContent.includes(t))?.click(), PANEL, UI.newThread);
  await page.waitForSelector(TA, { timeout: 10_000 });
  const marks = await page.evaluate((s, t) => [...document.querySelectorAll(`${s} [data-composer] button`)].filter((b) => b.textContent.includes(t)).length, PANEL, UI.mark);
  ok(marks === 1, `the Mark button is there (${marks})`);
  await page.type(TA, "make @");
  await page.waitForSelector("[data-mention-menu]", { timeout: 5_000 });
  const shown = await page.$$eval("[data-mention-menu] [data-mention-id]", (els) => els.map((e) => e.getAttribute("data-mention-id")));
  ok(shown.includes(A) && shown.includes(B), `"@" opens a menu of the screens (${shown.length} listed)`);
  await page.type(TA, "list");
  const filtered = await page.$$eval("[data-mention-menu] [data-mention-id]", (els) => els.map((e) => e.getAttribute("data-mention-id")));
  ok(filtered.length === 1 && filtered[0] === A, `typing narrows it (${filtered.join(", ")})`);
  await page.keyboard.press("Enter");
  let value = await page.$eval(TA, (el) => el.value);
  ok(value === `make @[${A}] `, `Enter writes the mention and sends nothing yet (${JSON.stringify(value)})`);
  ok(created.length === 0, "nothing was sent");
  ok((await page.$("[data-mention-menu]")) === null, "the menu closes");
  await page.type(TA, "tighter, like ");
  await page.click(`${PANEL} [data-composer] [data-mention-button]`);
  await page.waitForSelector("[data-mention-menu]", { timeout: 5_000 });
  await page.click(`[data-mention-menu] [data-mention-id="${B}"]`);
  value = await page.$eval(TA, (el) => el.value);
  ok(value === `make @[${A}] tighter, like @[${B}] `, `the "@" button and a click do the same (${JSON.stringify(value)})`);
  await page.keyboard.press("Enter");
  await until(() => created.length === 1, "the thread was created");
  ok(created[0].entry === "*", `the conversation belongs to the version: entry "*" (${created[0].entry})`);
  ok(created[0].viewing === B, `the screen being looked at is sent as viewing (${created[0].viewing})`);
  ok(created[0].text === `make @[${A}] tighter, like @[${B}]`, `the mentions travel in the text (${created[0].text})`);
  let mine;
  await until(async () => { mine = (await api("GET", "/__api/threads?entry=*")).threads.find((t) => t.messages[0]?.text.startsWith("make @[")); return !!mine; }, "the server stored the conversation");
  if (mine) cleanup(`thread ${mine.id}`, () => api("DELETE", `/__api/threads/${mine.id}`)); // queued first: it runs even if a check below fails
  ok(!!mine, "the server has it as a global thread");
  ok(mine.title === "make list tighter, like detail", `the title reads well, no raw @[…] in it ("${mine.title}")`);

  // ── The mention is a link; the conversation stays open when it is followed ──
  await page.waitForSelector("[data-mention]", { timeout: 10_000 });
  const chips = await page.$$eval("[data-mention]", (els) => els.map((e) => [e.getAttribute("data-mention"), e.textContent.trim()]));
  ok(chips.length === 2 && chips[0][0] === A && chips[0][1].includes("Task list") && chips[1][0] === B, `mentions are shown as links with the screen's title (${chips.map((c) => c[1]).join(" | ")})`);
  await page.click(`[data-mention="${A}"]`);
  await until(async () => new URL(page.url()).searchParams.get("e") === A, "the screen changed");
  const stillOpen = await page.waitForFunction((t) => document.querySelector("[data-composer]") && document.querySelector("[data-mention]"), { timeout: 10_000 }).then(() => true, () => false);
  ok(stillOpen && new URL(page.url()).searchParams.get("t") === mine.id, "following a mention changes the screen and keeps the conversation open");

  // ── The same conversations on every screen; a message says what the sender was looking at ──
  await api("POST", `/__api/threads/${mine.id}/messages`, { text: "and the list too", refs: [], viewing: A, noAgent: true });
  await gotoReady(page, studioUrl({ e: B, t: mine.id }));
  await page.waitForSelector("[data-message-on]", { timeout: 10_000 });
  const on = await page.$eval("[data-message-on]", (el) => el.textContent);
  ok(on.includes(UI.lookingAt) && on.includes("Task list"), `a message sent while looking at another screen says which one ("${on.trim()}")`);
  await shot(page, "global-chat-1280");

  // ── The quiet link: a conversation that waits for you shows on the screens it mentions, and on the tab ──
  const row = (id) => `a[href="?e=${encodeURIComponent(id)}"]`;
  const badge = (id) => page.$eval(row(id), (a) => { const b = a.querySelector("[data-attention]"); return b ? b.textContent.trim() : null; }).catch(() => null);
  await api("POST", `/__api/threads/${mine.id}/claude`, { text: `Done on @[${A}] and @[${B}].`, refs: [] });
  await gotoReady(page, studioUrl({ e: B }));
  await page.waitForSelector(`${row(A)} [data-attention]`, { timeout: 10_000 });
  ok((await badge(A)) === "1" && (await badge(B)) === "1", `the screens the conversation mentions show it waits for you (A ${await badge(A)}, B ${await badge(B)})`);
  await shot(page, "global-chat-badge-1280");
  const hint = await page.$eval(`${row(A)} [data-attention]`, (el) => el.getAttribute("title"));
  ok(hint.startsWith(UI.waitingForYouHint) && hint.includes("make list tighter"), `hovering the badge names the conversation ("${hint}")`);
  const others = await page.$$eval("nav a[data-option-of], nav a[href^='?e=']", (as) => as.filter((a) => a.querySelector("[data-attention]")).map((a) => a.getAttribute("href")));
  ok(others.length === 2, `no other screen is marked (${others.join(", ")})`);
  const tabBadge = await page.$eval(`${PANEL} [role=tab] [data-attention-count]`, (el) => el.textContent.trim());
  ok(tabBadge === "1", `the Conversation tab says how many conversations wait for you (${tabBadge})`);
  const preview = await page.$eval(`${PANEL}`, (el) => el.textContent);
  ok(preview.includes("Claude: Done on Task list and Task detail".replace("Task list", "list").replace("Task detail", "detail")) && !preview.includes("@["), "the list's preview line names the screens without the raw @[…]");
  await api("POST", `/__api/threads/${mine.id}/messages`, { text: "thanks, go on", refs: [], noAgent: true });
  await gotoReady(page, studioUrl({ e: B }));
  await sleep(600);
  ok((await badge(A)) === null && (await badge(B)) === null && (await page.$(`${PANEL} [data-attention-count]`)) === null, "once you answer, the badges are gone");

  // ── A running turn: every screen says Claude is editing ──
  const file = projectFile("threads", `${mine.id}.json`);
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  j.agent = { ...j.agent, state: "running", progress: { key: "browsing", params: { what: "all" } } };
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
  await gotoReady(page, studioUrl({ e: A }));
  const busy = await page.waitForFunction((t) => document.querySelector("[data-claude-busy]")?.textContent.includes(t), { timeout: 10_000, polling: 150 }, UI.claudeBusy).then(() => true, () => false);
  ok(busy, `a screen says "${UI.claudeBusy}" while a global turn runs`);
  j.agent = { ...j.agent, state: "idle", progress: null };
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");

  // ── The old per-screen thread still opens ──
  await gotoReady(page, studioUrl({ e: A }));
  await panelHas("E2E legacy screen thread");
  await clickPanel("E2E legacy screen thread");
  await panelHas("an old thread of the task list");
  ok(true, "a thread made on one screen still opens");

  // ── Reload ──
  await gotoReady(page, studioUrl({ e: A }));
  await panelHas("make list tighter");
  ok(true, "after a reload the global conversation is still in the list");
  await sleep(200);
  ok(problems.length === 0, `the browser console stayed clean (${problems.slice(0, 3).join(" | ")})`);
});
