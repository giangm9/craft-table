// e2e: the canvas in the middle of the studio, and what reaches the prototypes on it.
//   • wheel on the background zooms; over a frame the wheel belongs to the frame (it scrolls it), Ctrl+wheel zooms
//   • the middle button drags the canvas, also over a frame; the left button drags it from the background; "Fit"
//     brings back the view the page opened with
//   • C turns annotate mode on without moving anything, Esc turns it off
//   • the prototype in a frame is clickable (a filter button filters the list); with the focus inside the frame C
//     still reaches the studio; typing "c" in a text box of the frame types it and leaves annotate mode off
//   • the screen list folds and unfolds a group
//   • phone 390: only the mobile frames are shown
// Nothing is created. Screenshots: tests/shots/canvas-*.png
import { DESKTOP, PHONE, UI, entries, gotoReady, newPage, ok, run, shot, sleep, studioUrl } from "./lib/e2e.mjs";

const ENTRY = "screens/tasks/list";

await run("canvas", async ({ browser }) => {
  const meta = (await entries()).find((e) => e.id === ENTRY).meta;
  const page = await newPage(browser, DESKTOP);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  await gotoReady(page, studioUrl({ e: ENTRY }));
  await page.waitForFunction(() => document.querySelectorAll("iframe").length >= 2
    && [...document.querySelectorAll("iframe")].every((f) => f.contentDocument?.getElementById("root")?.children.length), { timeout: 60_000 });
  await sleep(600);
  await shot(page, "canvas-1280");

  const zoom = () => page.$eval(`button[title="${UI.zoomReset}"]`, (b) => b.textContent.trim());
  const world = () => page.evaluate(() => document.querySelector("[data-canvas-bg] > div").style.transform);
  // A point of the canvas background (no frame, no button), searched from the bottom right corner.
  const emptyPoint = () => page.evaluate(() => {
    const b = document.querySelector("[data-canvas-bg]").getBoundingClientRect();
    for (let y = b.bottom - 15; y > b.top + 15; y -= 25) for (let x = b.right - 15; x > b.left + 15; x -= 25) {
      const el = document.elementFromPoint(x, y);
      if (el && el.closest("[data-canvas-bg]") && !el.closest("[data-frame]") && !el.closest("button")) return { x, y };
    }
    return null;
  });
  // A point inside the first frame that is on screen.
  const framePoint = () => page.evaluate(() => {
    const b = document.querySelector("[data-canvas-bg]").getBoundingClientRect();
    for (const f of document.querySelectorAll("iframe")) {
      const r = f.getBoundingClientRect();
      const x = Math.max(r.left, b.left) + 20, y = Math.max(r.top, b.top) + 20;
      if (x < Math.min(r.right, b.right) && y < Math.min(r.bottom, b.bottom) && document.elementFromPoint(x, y) === f) return { x, y };
    }
    return null;
  });
  const startZoom = await zoom(), startWorld = await world();

  // ── Zoom ──
  const ep = await emptyPoint();
  ok(!!ep, "the canvas has some empty background");
  await page.mouse.move(ep.x, ep.y);
  await page.mouse.wheel({ deltaY: -300 });
  await sleep(250);
  const z1 = await zoom();
  ok(z1 !== startZoom, `wheel on the background zooms (${startZoom} → ${z1})`);
  const fp = await framePoint();
  ok(!!fp, "a frame is on screen");
  await page.mouse.move(fp.x, fp.y);
  await page.mouse.wheel({ deltaY: 300 });
  await sleep(250);
  ok((await zoom()) === z1, "wheel over a frame does not zoom (the frame scrolls)");
  await page.keyboard.down("Control");
  await page.mouse.wheel({ deltaY: 300 });
  await page.keyboard.up("Control");
  await sleep(250);
  const z2 = await zoom();
  ok(z2 !== z1, `Ctrl+wheel over a frame zooms the canvas (${z1} → ${z2})`);

  // ── Drag ──
  const w0 = await world();
  const fp2 = await framePoint();
  await page.mouse.move(fp2.x, fp2.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(fp2.x + 100, fp2.y + 50, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  await sleep(150);
  const w1 = await world();
  ok(w1 !== w0, "the middle button drags the canvas, even over a frame");
  const ep2 = await emptyPoint();
  await page.mouse.move(ep2.x, ep2.y);
  await page.mouse.down();
  await page.mouse.move(ep2.x - 50, ep2.y - 20, { steps: 5 });
  await page.mouse.up();
  await sleep(150);
  ok((await world()) !== w1, "the left button drags the canvas from the background");
  await page.click(`button[aria-label="${UI.fit}"]`);
  await sleep(400);
  ok((await zoom()) === startZoom && (await world()) === startWorld, `"${UI.fit}" brings back the opening view (${startZoom})`);

  // ── Annotate mode ──
  const annotating = () => page.evaluate((t) => [...document.querySelectorAll("header button")].some((b) => b.textContent.includes(t)), UI.annotating);
  const top = () => page.$eval("[data-canvas-bg]", (el) => el.getBoundingClientRect().top);
  const top0 = await top();
  await page.keyboard.press("c");
  await sleep(150);
  ok((await annotating()) && (await top()) === top0, "C turns annotate mode on, nothing moves");
  await page.keyboard.press("Escape");
  await sleep(150);
  ok(!(await annotating()), "Esc turns it off");

  // ── The prototype in a frame, and the keyboard ──
  await gotoReady(page, studioUrl({ e: ENTRY, vp: "desktop" }));
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.querySelector("[aria-pressed]"), { timeout: 30_000 });
  await sleep(500);
  const rows = () => page.evaluate(() => document.querySelector("iframe").contentDocument.querySelectorAll("main ul > li").length);
  const before = await rows();
  // Screen position of the frame's "Open" filter button (the frame is scaled by the canvas zoom).
  const pt = await page.evaluate(() => {
    const f = document.querySelector("iframe");
    const btn = [...f.contentDocument.querySelectorAll("button[aria-pressed]")].find((x) => x.textContent.trim().startsWith("Open"));
    const fr = f.getBoundingClientRect(), br = btn.getBoundingClientRect(), z = fr.width / f.offsetWidth;
    return { x: fr.left + (br.left + br.width / 2) * z, y: fr.top + (br.top + br.height / 2) * z };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction(() => [...document.querySelector("iframe").contentDocument.querySelectorAll("button[aria-pressed=true]")].some((b) => b.textContent.trim().startsWith("Open")), { timeout: 5000 });
  const after = await rows();
  ok(after > 0 && after < before, `the prototype is clickable in the studio: "Open" filters the list (${before} → ${after} rows)`);
  await page.keyboard.press("c");
  await sleep(150);
  ok(await annotating(), "with the focus inside the frame, C still turns annotate mode on");
  await page.keyboard.press("Escape");
  await sleep(150);
  ok(!(await annotating()), "and Esc from inside the frame turns it off");
  const input = await page.evaluate(() => {
    const f = document.querySelector("iframe");
    const el = f.contentDocument.querySelector("input[aria-label='New task']");
    const fr = f.getBoundingClientRect(), r = el.getBoundingClientRect(), z = fr.width / f.offsetWidth;
    return { x: fr.left + (r.left + r.width / 2) * z, y: fr.top + (r.top + r.height / 2) * z };
  });
  await page.mouse.click(input.x, input.y);
  await page.keyboard.type("c");
  await sleep(150);
  const typed = await page.evaluate(() => document.querySelector("iframe").contentDocument.querySelector("input[aria-label='New task']").value);
  ok(typed === "c" && !(await annotating()), `typing "c" in the frame's text box types it (${JSON.stringify(typed)}), annotate mode stays off`);
  await shot(page, "canvas-1280-prototype");

  // ── Screen list: fold / unfold a group ──
  const hasItem = () => page.$$eval("aside:not([data-panel]) a", (as, t) => as.some((a) => a.textContent.includes(t)), meta.title);
  const clickGroup = () => page.evaluate((g) => [...document.querySelectorAll("aside:not([data-panel]) button")].find((b) => b.textContent.trim().startsWith(g))?.click(), meta.group);
  ok(await hasItem(), `the screen list shows "${meta.title}"`);
  await clickGroup(); await sleep(200);
  const hidden = !(await hasItem());
  await clickGroup(); await sleep(200);
  ok(hidden && (await hasItem()), `the group "${meta.group}" folds and unfolds`);
  ok(errors.length === 0, `no script errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await page.close();

  // ── Phone ──
  const m = await newPage(browser, PHONE);
  await gotoReady(m, studioUrl({ e: ENTRY }));
  await m.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.getElementById("root")?.children.length, { timeout: 30_000 });
  await sleep(600);
  const widths = await m.$$eval("iframe", (fs) => [...new Set(fs.map((f) => f.offsetWidth))]);
  ok(widths.length === 1 && widths[0] < 500, `390: only the mobile frames (${widths.join(", ")}px wide)`);
  await shot(m, "canvas-390");
  await m.close();
});
