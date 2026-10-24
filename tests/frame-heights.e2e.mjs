// e2e: frame sizes on the canvas, for EVERY board of the live version.
//   • default: desktop frames exactly 1280×800, mobile frames exactly the default phone (390×844) — no frame grows
//     with its content (a board using "screen height" once made frames endlessly tall)
//   • "Whole page" (dev=full): frames follow their content but stay ≤ the cap (6000); boards that hit the cap are
//     listed
// Sizes come from studio/lib/devices.mjs. A busy machine can be slow → each board gets one retry.
// Argument: "default" | "full" to run one half. Screenshots: tests/shots/heights-*.png
import { DESKTOP, FULL_MAX_H, deviceOf, DEFAULT_DEVICE } from "../studio/lib/devices.mjs";
import { entries, newPage, ok, run, shot, sleep, studioUrl } from "./lib/e2e.mjs";

const only = process.argv[2];
const PHONE = deviceOf(DEFAULT_DEVICE);
const sizes = (page) => page.evaluate(() => [...document.querySelectorAll("iframe")].map((f) => ({ w: f.offsetWidth, h: f.offsetHeight })));

await run("frame-heights", async ({ browser }) => {
  const ids = (await entries()).map((e) => e.id);
  console.log(`${ids.length} boards`);
  const page = await newPage(browser, { width: 1280, height: 800 });
  async function open(url, wait) {
    for (let k = 0; ; k++) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.querySelectorAll("iframe").length > 0, { timeout: 60_000 });
        await sleep(wait);
        return await sizes(page);
      } catch (e) { if (k) throw e; await sleep(3000); }
    }
  }
  if (only !== "full") {
    const bad = [];
    for (const [i, id] of ids.entries()) {
      const fr = await open(studioUrl({ e: id }), 300);
      const wrong = fr.filter((f) => !((f.w === DESKTOP.w && f.h === DESKTOP.h) || (f.w === PHONE.w && f.h === PHONE.h)));
      if (!fr.length || wrong.length) { bad.push(id); console.log(`✗ ${id}: ${fr.length} frames, wrong size: ${JSON.stringify(wrong.slice(0, 3))}`); }
      if (i === 0) { await sleep(3000); await shot(page, "heights-1280-default"); }
    }
    ok(bad.length === 0, `every board (${ids.length}): desktop frames ${DESKTOP.w}×${DESKTOP.h}, mobile frames ${PHONE.w}×${PHONE.h}`);
  }
  if (only !== "default") {
    let tallest = { id: null, h: 0 };
    const capped = [], over = [];
    for (const id of ids) {
      const fr = await open(studioUrl({ e: id, dev: "full" }), 4000);
      const max = Math.max(0, ...fr.map((f) => f.h));
      if (max > FULL_MAX_H) over.push(`${id} (${max})`);
      if (max >= FULL_MAX_H) capped.push(id);
      if (max > tallest.h) tallest = { id, h: max };
    }
    console.log(`"Whole page": tallest frame ${tallest.h} (${tallest.id}); at the ${FULL_MAX_H} cap: ${capped.length ? capped.join(", ") : "none"}`);
    ok(over.length === 0, `"Whole page": no frame taller than ${FULL_MAX_H}${over.length ? ` — ${over.join(", ")}` : ""}`);
    if (tallest.id) {
      await open(studioUrl({ e: tallest.id, dev: "full" }), 4000);
      await shot(page, "heights-1280-whole-page-tallest");
    }
  }
  await page.close();
});
