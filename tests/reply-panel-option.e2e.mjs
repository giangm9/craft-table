// e2e of three things in the right panel and the option bar:
//   1. Claude's answer renders its markdown (bold, list, code, table) and its annotation chips, no raw symbols — the
//      answer is posted through the local-only /claude route, no real Claude involved
//   2. the conversation panel can be dragged wider, keeps its width after a reload, double-click resets it
//   3. renaming an option (pencil on the option bar) → the bar and the screen list show the new name, the URL stays
// The thread and the option are removed at the end. Screenshots: tests/shots/rpo-*.png
import { PANEL_DEFAULT } from "../studio/lib/panel-width.mjs";
import { DESKTOP, PHONE, UI, api, newPage, ok, run, shot, sleep, studioUrl } from "./lib/e2e.mjs";

const ENTRY = "screens/tasks/list";
const REPLY = [
  "**Done:** the button [#1] now says `Mark all as done`.",
  "",
  "- typecheck clean",
  "- spec updated",
  "",
  "Option A, three buttons: faster. Option B, one button: tidier.",
  "",
  "| Option | Clicks |",
  "|---|---|",
  "| A | 1 |",
  "| B | 2 |",
].join("\n");

async function gotoReady(p, url) {
  await p.goto(url, { waitUntil: "load" });
  await p.waitForFunction(() => document.getElementById("root")?.children.length, { timeout: 60_000, polling: 200 }).catch(() => {});
  await sleep(1500);
}

await run("reply-panel-option", async ({ browser, cleanup }) => {
  const { thread } = await api("POST", "/__api/threads", { entry: ENTRY, text: "How should the answer look?", noAgent: true });
  cleanup("thread", () => api("DELETE", `/__api/threads/${thread.id}`));
  await api("POST", `/__api/threads/${thread.id}/claude`, { text: REPLY, refs: [{ scenario: null, viewport: "desktop", rect: { x: 300, y: 120, w: 160, h: 40 }, texts: ["Add"] }] });

  const page = await newPage(browser, DESKTOP);
  await page.evaluateOnNewDocument(() => { try { localStorage.removeItem("studio:panelWidth"); } catch { /* private mode */ } });
  await gotoReady(page, studioUrl({ e: ENTRY, t: thread.id }));

  // ── 1. Markdown ──
  await page.waitForSelector("[data-reply]", { timeout: 30_000 });
  const md = await page.$eval("[data-reply]", (el) => ({
    strong: el.querySelector("strong")?.textContent, code: el.querySelector("code")?.textContent,
    li: el.querySelectorAll("ul > li").length, th: el.querySelectorAll("table th").length, td: el.querySelectorAll("table td").length,
    chips: [...el.querySelectorAll("button")].map((b) => b.textContent), raw: el.textContent.includes("**") || el.textContent.includes("|---"),
  }));
  ok(md.strong === "Done:", `bold text (${md.strong})`);
  ok(md.code === "Mark all as done", "inline code");
  ok(md.li === 2, "a list of 2");
  ok(md.th === 2 && md.td === 4, "a table of 2 columns, 2 rows");
  ok(md.chips.some((c) => /^#\d+$/.test(c)), `an annotation chip in the answer (${md.chips})`);
  ok(!md.raw, "no raw markdown symbols");

  // ── 2. Drag the panel wider ──
  const w0 = await page.$eval("[data-panel]", (el) => el.getBoundingClientRect().width);
  ok(Math.round(w0) === PANEL_DEFAULT, `default width ${PANEL_DEFAULT} (${w0})`);
  const g = await page.$eval("[data-panel-resize]", (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 300 }; });
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  await page.mouse.move(g.x - 120, g.y, { steps: 6 });
  await page.mouse.move(g.x - 200, g.y, { steps: 6 });
  await page.mouse.up();
  await sleep(300);
  const w1 = await page.$eval("[data-panel]", (el) => el.getBoundingClientRect().width);
  ok(Math.abs(w1 - (PANEL_DEFAULT + 200)) <= 2, `dragged 200px left → ${PANEL_DEFAULT + 200} wide (${w1})`);
  await shot(page, "rpo-1280-reply-wide");
  const p2 = await newPage(browser, DESKTOP); // same browser profile: the stored width carries over
  await gotoReady(p2, studioUrl({ e: ENTRY, t: thread.id }));
  const w2 = await p2.$eval("[data-panel]", (el) => el.getBoundingClientRect().width);
  ok(Math.abs(w2 - (PANEL_DEFAULT + 200)) <= 2, `a reload keeps ${PANEL_DEFAULT + 200} (${w2})`);
  const g2 = await p2.$eval("[data-panel-resize]", (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 300 }; });
  await p2.mouse.click(g2.x, g2.y, { count: 2 });
  await sleep(300);
  const w3 = await p2.$eval("[data-panel]", (el) => el.getBoundingClientRect().width);
  ok(Math.round(w3) === PANEL_DEFAULT, `double-click → back to ${PANEL_DEFAULT} (${w3})`);
  await p2.close();

  // ── 3. Rename an option ──
  const optionId = (await api("POST", "/__api/options", { entries: [ENTRY], name: "Naming test" })).ids[0];
  cleanup("option", () => api("POST", "/__api/options/remove", { entry: optionId }));
  await gotoReady(page, studioUrl({ e: optionId }));
  await page.waitForSelector("[data-option-bar]", { timeout: 30_000 });
  await page.click(`button[aria-label="${UI.renameOption}"]`);
  await page.waitForSelector("[data-option-rename]");
  await page.$eval("[data-option-rename]", (el) => el.select());
  await page.type("[data-option-rename]", "Three plain buttons");
  await shot(page, "rpo-1280-rename-dialog");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-option-bar]")?.textContent.includes("Three plain buttons"), { timeout: 15_000 });
  ok(true, "the option bar shows the new name");
  await page.waitForFunction((id) => document.querySelector(`a[href="?e=${encodeURIComponent(id)}"]`)?.textContent.includes("Three plain buttons"), { timeout: 15_000 }, optionId);
  ok(true, "the screen list shows the new name");
  ok(new URL(page.url()).searchParams.get("e") === optionId, "the option's address is unchanged");
  await shot(page, "rpo-1280-option-renamed");
  await page.close();

  // ── Phone 390 ──
  const m = await newPage(browser, PHONE);
  await gotoReady(m, studioUrl({ e: ENTRY, t: thread.id, panel: 1 }));
  await m.waitForFunction(() => [...document.querySelectorAll("[data-panel] [data-reply]")].some((el) => el.getBoundingClientRect().width > 0), { timeout: 30_000 });
  ok(true, "390: the answer shows in the chat sheet");
  await shot(m, "rpo-390-reply");
  await gotoReady(m, studioUrl({ e: optionId, opt: "rename" }));
  await m.waitForSelector("[data-option-rename]", { timeout: 30_000 });
  ok(true, "390: the rename dialog opens from the URL (opt=rename)");
  await shot(m, "rpo-390-rename-dialog");
  await m.close();
});
