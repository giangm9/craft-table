// e2e: phone frames on the canvas.
//   • a mobile frame has the size of the default phone, whatever the board's length; the long content scrolls
//     inside it
//   • the phone select lists every phone plus "whole page"; picking another phone resizes the frame
//   • the wheel over a phone frame scrolls its content and leaves the canvas zoom alone; Ctrl+wheel zooms
//   • annotating inside a scrolled frame: the pending marker sits exactly where the drag started
//   • "whole page": the frame grows with its content
// Sizes come from studio/lib/devices.mjs. Nothing is created. Screenshots: tests/shots/phone-*.png
import { DEFAULT_DEVICE, DEVICES, FULL_DEVICE, deviceOf } from "../studio/lib/devices.mjs";
import { DESKTOP, UI, entries, gotoReady, newPage, ok, run, shot, sleep, studioUrl } from "./lib/e2e.mjs";

const ENTRY = "screens/tasks/list";
const LONG = "many-tasks"; // a scenario longer than any phone
const SMALL = DEVICES.reduce((a, b) => (b.h < a.h ? b : a)); // the shortest phone
const FULL = FULL_DEVICE; // the select's "whole page" value (dev=full)

await run("phone-frames", async ({ browser }) => {
  const meta = (await entries()).find((e) => e.id === ENTRY).meta;
  ok(meta.scenarios.some((s) => s.id === LONG), `${ENTRY} has the long scenario ${LONG}`);
  const page = await newPage(browser, DESKTOP);
  const sel = `iframe[title="${meta.title} · ${LONG} · mobile"]`;
  const frame = () => page.$eval(sel, (f) => ({ w: f.style.width, h: f.style.height, scrollY: f.contentWindow.scrollY, docH: f.contentDocument.documentElement.scrollHeight }));
  const zoom = () => page.$eval(`button[title="${UI.zoomReset}"]`, (b) => b.textContent.trim());
  const open = async (dev) => {
    await gotoReady(page, studioUrl({ e: ENTRY, vp: "mobile", s: LONG, dev }));
    await page.waitForFunction((s) => document.querySelector(s)?.contentDocument?.getElementById("root")?.children.length, { timeout: 30_000 }, sel);
    await sleep(800);
  };

  await open(null);
  const def = deviceOf(DEFAULT_DEVICE);
  let f = await frame();
  ok(f.w === `${def.w}px` && f.h === `${def.h}px` && f.docH > def.h, `the default phone frame is ${def.name} ${def.w}×${def.h} (${f.w}×${f.h}), the content (${f.docH}px) scrolls inside`);
  const opts = await page.$$eval(`header select[aria-label="${UI.deviceSelect}"] option`, (os) => os.map((o) => o.value));
  ok(JSON.stringify(opts) === JSON.stringify([...DEVICES.map((d) => d.id), FULL]), `the phone select lists ${DEVICES.length} phones and "whole page"`);
  await shot(page, "phone-1280-default");

  await open(SMALL.id);
  f = await frame();
  ok(f.w === `${SMALL.w}px` && f.h === `${SMALL.h}px`, `${SMALL.name} → the frame is ${f.w}×${f.h}`);

  // ── Wheel ──
  const z0 = await zoom();
  const c = await page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(c.x, c.y);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel({ deltaY: 200 }); await sleep(80); }
  await sleep(300);
  f = await frame();
  ok(f.scrollY > 0 && (await zoom()) === z0, `the wheel over the phone frame scrolls its content (${Math.round(f.scrollY)}px), the canvas stays at ${z0}`);

  // ── Annotate inside the scrolled frame ──
  await page.keyboard.press("c");
  await sleep(150);
  const r0 = await page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const sx = r0.x + r0.w * 0.2, sy = r0.y + r0.h * 0.3;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + r0.w * 0.4, sy + r0.h * 0.15, { steps: 6 });
  await page.mouse.up();
  await sleep(400);
  const mk = await page.$eval("[data-ref='pending:0']", (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; }).catch(() => null);
  ok(!!mk && Math.abs(mk.x - sx) <= 6 && Math.abs(mk.y - sy) <= 6, `annotating in the scrolled frame: the marker is where the drag started (drag ${Math.round(sx)},${Math.round(sy)} · marker ${mk ? `${Math.round(mk.x)},${Math.round(mk.y)}` : "none"})`);
  await shot(page, "phone-1280-scrolled");
  await page.keyboard.press("Escape");

  // ── Ctrl+wheel zooms ──
  await page.mouse.move(c.x, c.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel({ deltaY: -300 });
  await page.keyboard.up("Control");
  await sleep(300);
  const z1 = await zoom();
  ok(z1 !== z0, `Ctrl+wheel over the phone frame zooms the canvas (${z0} → ${z1})`);

  // ── Whole page ──
  await open(FULL);
  await sleep(1500); // the frame measures its content, then grows
  f = await frame();
  ok(parseInt(f.h, 10) > def.h, `"whole page" → the frame grows with its content (${f.h})`);
  await shot(page, "phone-1280-whole-page");
  await page.close();
});
