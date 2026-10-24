// e2e: the screen list shows options tidily. Every option has its NAME and sits RIGHT UNDER its main screen
// (indented), even with options of two screens of the same group. Options are created through the API and
// removed at the end. Screenshot: tests/shots/sidebar-options-1280.png
import { DESKTOP, SHOTS, api, entries, newPage, ok, run, sleep, studioUrl } from "./lib/e2e.mjs";

const MAINS = { "screens/tasks/list": "Compact rows", "screens/tasks/detail": "Two columns" };

await run("sidebar-options", async ({ browser, cleanup }) => {
  const known = new Set((await entries()).map((e) => e.id));
  const created = [];
  for (const [main, name] of Object.entries(MAINS)) {
    ok(known.has(main), `the project has ${main}`);
    const id = (await api("POST", "/__api/options", { entries: [main], name })).ids[0];
    created.push({ id, main, name });
    cleanup(`option ${id}`, () => api("POST", "/__api/options/remove", { entry: id }));
  }

  const page = await newPage(browser, DESKTOP);
  await page.goto(studioUrl({ e: "screens/tasks/list" }), { waitUntil: "domcontentloaded" });
  await page.waitForFunction((n) => document.querySelectorAll("a[data-option-of]").length >= n, {}, created.length);
  await sleep(1000);
  // Every row of the screen list, in order: id, whose option it is, the text shown.
  const rows = await page.$$eval("aside a[href^='?e=']", (as) => as.map((a) => ({ id: decodeURIComponent(a.getAttribute("href").slice(3)), of: a.getAttribute("data-option-of"), text: a.textContent.trim() })));
  for (const o of created) {
    const i = rows.findIndex((r) => r.id === o.id), main = rows.findIndex((r) => r.id === o.main);
    ok(i >= 0 && rows[i].of === o.main, `"${o.id}" is listed as an option of ${o.main}`);
    ok(rows[i].text.includes(o.name), `"${o.id}" shows its name (${rows[i].text})`);
    ok(main >= 0 && main < i && rows.slice(main + 1, i).every((r) => r.of === o.main), `"${o.id}" sits right under ${o.main}`);
  }
  const box = await page.$eval("aside", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.screenshot({ path: `${SHOTS}sidebar-options-1280.png`, clip: { x: box.x, y: box.y, width: box.w, height: Math.min(box.h, DESKTOP.height) } });
  await page.close();
});
