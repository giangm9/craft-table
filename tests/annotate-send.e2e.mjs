// e2e: annotate → send → a thread, and Claude's answer arriving while the page is open.
//   • C, then a drag that starts on the background and ends inside the first mobile frame: the region is cut at
//     the frame's edge and becomes the pending annotation +1 — "[#1]" in the composer, no comment box on the
//     canvas, and the drag did not move the canvas
//   • Send → a new thread whose first message holds annotation #1 on that frame (scenario, x = 0, size = the drag
//     divided by the zoom); its chip brings the region to the middle of the canvas
//   • Claude's answer (posted through the local-only /claude route, no real Claude) shows up without reloading the
//     page, with Claude's own marker on the frame; the thread list says the thread waits for you
// The thread is sent from the page with the studio's noAgent switch on, and deleted at the end.
// Screenshots: tests/shots/annotate-*.png
import { DESKTOP, UI, api, entries, gotoReady, newPage, ok, run, shot, sleep, studioUrl, until } from "./lib/e2e.mjs";

const ENTRY = "screens/tasks/list";
const TEXT = "Make the add button bigger here";

await run("annotate-send", async ({ browser, cleanup }) => {
  const first = (await entries()).find((e) => e.id === ENTRY).meta.scenarios[0];
  const page = await newPage(browser, DESKTOP);
  // Mobile frames only: they are larger on the canvas, so the drag is a comfortable size.
  await gotoReady(page, studioUrl({ e: ENTRY, vp: "mobile" }));
  await page.waitForFunction(() => document.querySelectorAll("iframe").length >= 2, { timeout: 60_000 });
  await sleep(600);
  await page.evaluate(() => { window.__noReload = true; }); // gone if the page reloads
  const world = () => page.evaluate(() => document.querySelector("[data-canvas-bg] > div").style.transform);
  const zoom = parseInt(await page.$eval(`button[title="${UI.zoomReset}"]`, (b) => b.textContent), 10) / 100;

  // ── Draw ──
  await page.keyboard.press("c");
  await sleep(150);
  const m = await page.$eval('iframe[title$=" · mobile"]', (f) => { const r = f.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const DW = Math.round(m.w * 0.5), DH = Math.round(Math.min(120, m.h * 0.4));
  const w0 = await world();
  await page.mouse.move(m.x - 12, m.y + 30); // on the background, left of the frame
  await page.mouse.down();
  await page.mouse.move(m.x + DW, m.y + 30 + DH, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  ok((await world()) === w0, "a drag that starts on the background annotates, it does not move the canvas");
  const ta = "[data-panel] [data-composer] textarea";
  await page.waitForSelector(ta, { timeout: 10_000 });
  const text = await page.$eval(ta, (t) => t.value);
  const chip = await page.evaluate(() => [...document.querySelectorAll("[data-panel] button")].some((b) => b.textContent.trim() === "+1"));
  ok(chip && text.includes("[#1]"), `the region becomes pending annotation +1, "[#1]" in the composer (${JSON.stringify(text)})`);
  ok(!(await page.$("[data-canvas-bg] textarea")), "no comment box on the canvas");
  await shot(page, "annotate-1280-pending");

  // ── Send ──
  // The page makes the thread: its clean-up is queued before the send, so it runs even if the test stops right after.
  cleanup("thread", async () => {
    for (const t of (await api("GET", `/__api/threads?entry=${encodeURIComponent(ENTRY)}`)).threads) {
      if (t.messages[0]?.text.includes(TEXT)) await api("DELETE", `/__api/threads/${t.id}`);
    }
  });
  await page.type(ta, TEXT);
  await page.evaluate((label) => [...document.querySelectorAll("[data-panel] [data-composer] button")].find((b) => b.textContent.trim() === label)?.click(), UI.send);
  await page.waitForFunction((t) => document.querySelector("[data-panel]")?.innerText.includes(t), { timeout: 15_000 }, TEXT);
  await sleep(500);
  const mine = (await api("GET", `/__api/threads?entry=${encodeURIComponent(ENTRY)}`)).threads.find((t) => t.messages[0]?.text.includes(TEXT));
  ok(!!mine, "Send → a new thread on the screen");
  ok(mine.agent.state === "idle", `noAgent kept Claude out of it (agent ${mine.agent.state})`);
  const r = mine.messages[0].refs[0];
  const ew = DW / zoom, eh = DH / zoom;
  ok(r && r.scenario === first.id && r.viewport === "mobile" && r.rect.x === 0, `annotation #1 is on the first scenario's mobile frame, cut at its left edge (${r ? `${r.scenario} · ${r.viewport} · ${JSON.stringify(r.rect)}` : "none"})`);
  ok(Math.abs(r.rect.w - ew) <= ew * 0.08 && Math.abs(r.rect.h - eh) <= eh * 0.08, `its size is the drag divided by the zoom ${zoom}: ${r.rect.w}×${r.rect.h} ≈ ${Math.round(ew)}×${Math.round(eh)}`);

  // The chip #1 brings the region to the middle of the canvas.
  const key = `${mine.messages[0].id}:0`;
  await page.waitForSelector(`[data-ref="${key}"]`, { timeout: 10_000 });
  await page.evaluate(() => [...document.querySelectorAll("[data-panel] button")].find((b) => b.textContent.trim() === "#1")?.click());
  await sleep(600);
  const off = await page.evaluate((k) => {
    const el = document.querySelector(`[data-ref="${k}"]`), b = document.querySelector("[data-canvas-bg]").getBoundingClientRect();
    const rr = el.getBoundingClientRect();
    return { dx: Math.round(rr.left + rr.width / 2 - (b.left + b.width / 2)), dy: Math.round(rr.top + rr.height / 2 - (b.top + b.height / 2)) };
  }, key);
  ok(Math.abs(off.dx) <= 40 && Math.abs(off.dy) <= 40, `chip #1 → the region is in the middle of the canvas (off by ${off.dx}, ${off.dy} px)`);

  // ── Claude answers ──
  const ANSWER = "Here are three bigger buttons [#1]. Shall I keep A or B?";
  const answered = await api("POST", `/__api/threads/${mine.id}/claude`, { text: ANSWER, refs: [{ scenario: first.id, viewport: "mobile", rect: { x: 40, y: 120, w: 200, h: 60 }, texts: [] }] });
  const claudeKey = `${answered.thread.messages.at(-1).id}:0`;
  await page.waitForFunction((t) => document.querySelector("[data-panel]")?.innerText.includes(t), { timeout: 15_000 }, "Shall I keep A or B?");
  ok(await page.evaluate(() => window.__noReload === true), "Claude's answer shows up without reloading the page");
  await until(async () => !!(await page.$(`[data-ref="${claudeKey}"]`)), "Claude's marker on the frame");
  ok(true, "Claude's own annotation is drawn on the frame");
  await shot(page, "annotate-1280-answer");
  await page.click(`[data-panel] button[aria-label="${UI.backToThreads}"]`);
  await page.waitForFunction((t) => document.querySelector("[data-panel]")?.innerText.includes(t), { timeout: 10_000 }, UI.waitingForYou);
  ok(true, `the thread list says "${UI.waitingForYou}" (Claude spoke last)`);
  await shot(page, "annotate-1280-list");
  await page.close();
});
