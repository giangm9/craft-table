// e2e: the spec panel on the left of the studio (outside the canvas) and the /spec page.
//   • two tabs (Behavior, Technical); the panel sits left of the canvas and stays put when the canvas is dragged
//   • a table of contents, one page at a time; picking a page puts it in the URL (spp)
//   • clicking R1 in Behavior opens the Technical page that defines R1, with R1 in view
//   • the right edge drags the panel wider; folding it leaves a thin strip, still folded after a reload, and
//     unfolding brings back the width
//   • /spec: table of contents, one page; picking a page then Back returns to the first page
//   • with no source repository configured, /__src answers 404 and serves nothing
// Expected pages come from the spec itself (studio/lib/spec-core.mjs). Nothing is created; the panel's width and
// folded state live in the browser only. Screenshot: tests/shots/spec-panel-1280.png
import { ruleTarget, specPages } from "../studio/lib/spec-core.mjs";
import { DESKTOP, STUDIO, UI, api, gotoReady, newPage, ok, run, shot, sleep, studioUrl } from "./lib/e2e.mjs";

const ENTRY = "screens/tasks/list";
const GROW = 120;

await run("spec-panel", async ({ browser }) => {
  const md = async (kind) => (await api("GET", `/__api/spec?entry=${encodeURIComponent(ENTRY)}&kind=${kind}`)).markdown;
  const behavior = specPages(await md("behavior")), tech = specPages(await md("tech"));
  const page = await newPage(browser, DESKTOP);
  await gotoReady(page, studioUrl({ e: ENTRY }));
  await page.waitForSelector("[data-spec-panel] [data-spec-page]", { timeout: 30_000 });
  await sleep(500);

  const panel = await page.$("[data-spec-panel]");
  const tabs = await panel.$$eval("button", (bs) => bs.map((b) => b.textContent.trim()));
  ok(tabs.some((t) => t.startsWith(UI.behaviorTab)) && tabs.some((t) => t.startsWith(UI.techTab)), `two tabs: ${UI.behaviorTab} / ${UI.techTab}`);
  const canvas = await page.$eval("[data-canvas-bg]", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const inCanvas = await page.evaluate(() => !!document.querySelector("[data-canvas-bg] [data-spec-panel], [data-canvas-bg] [data-spec-page]"));
  const pb = await panel.boundingBox();
  ok(!inCanvas && pb.x + pb.width <= canvas.x + 2, "the spec panel sits left of the canvas, not on it");
  const before = JSON.stringify(await panel.boundingBox());
  await page.mouse.move(canvas.x + canvas.w / 2, canvas.y + canvas.h / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(canvas.x + canvas.w / 2, canvas.y + 60, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  await sleep(200);
  ok(before === JSON.stringify(await panel.boundingBox()), "dragging the canvas leaves the spec panel where it is");

  // ── Table of contents ──
  const toc = await page.evaluate(() => ({
    items: [...new Set([...document.querySelectorAll("[data-spec-panel] [data-toc-select] option, [data-spec-panel] [data-toc] [data-page]")].map((b) => b.value || b.getAttribute("data-page")))],
    pages: document.querySelectorAll("[data-spec-panel] [data-spec-page]").length,
    cur: document.querySelector("[data-spec-panel] [data-spec-page]")?.getAttribute("data-spec-page"),
  }));
  ok(JSON.stringify(toc.items) === JSON.stringify(behavior.map((p) => p.id)), `the table of contents lists the ${behavior.length} pages of the spec`);
  ok(toc.pages === 1 && toc.cur === behavior[0].id, `one page is shown, the first (${toc.cur})`);
  const pick = (id) => page.evaluate((t) => {
    const btn = document.querySelector(`[data-spec-panel] [data-toc] [data-page="${t}"]`);
    const sel = document.querySelector("[data-spec-panel] [data-toc-select]");
    if (btn && btn.offsetParent) btn.click();
    else if (sel) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, t); sel.dispatchEvent(new Event("change", { bubbles: true })); }
  }, id);
  const where = () => page.evaluate(() => {
    const q = new URLSearchParams(location.search);
    return { sp: q.get("sp"), spp: q.get("spp"), cur: document.querySelector("[data-spec-panel] [data-spec-page]")?.getAttribute("data-spec-page") };
  });
  const target = behavior[2].id;
  await pick(target);
  await sleep(400);
  const moved = await where();
  ok(moved.spp === target && moved.cur === target, `picking "${behavior[2].title}" shows that page and writes it in the URL (spp=${moved.spp})`);

  // ── R1 → the Technical page that defines it ──
  const r1Page = behavior.find((p) => p.rules.includes("R1"));
  await pick(r1Page.id);
  await page.waitForSelector("[data-spec-panel] [data-spec-page] [data-rule='R1']", { timeout: 10_000 });
  await page.evaluate(() => document.querySelector("[data-spec-panel] [data-spec-page] [data-rule='R1']").click());
  await sleep(700);
  const jumped = await page.evaluate(() => {
    const q = new URLSearchParams(location.search);
    const el = document.querySelector("[data-spec-panel] [data-spec-page] [data-rule='R1']");
    const body = document.querySelector("[data-spec-panel] [data-spec-scroll]");
    const r = el?.getBoundingClientRect(), b = body?.getBoundingClientRect();
    return { sp: q.get("sp"), spp: q.get("spp"), visible: !!(r && b && r.top >= b.top && r.bottom <= b.bottom) };
  });
  const want = ruleTarget(tech, "R1");
  ok(jumped.sp === "tech" && jumped.spp === want && jumped.visible, `R1 in ${UI.behaviorTab} → ${UI.techTab}, page ${jumped.spp} (expected ${want}), R1 in view`);
  await shot(page, "spec-panel-1280");

  // ── Width, fold ──
  const w0 = (await panel.boundingBox()).width;
  const grip = await (await page.$("[data-spec-panel] [data-spec-resize]")).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 200);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + GROW, grip.y + 200, { steps: 8 });
  await page.mouse.up();
  await sleep(200);
  const w1 = (await panel.boundingBox()).width;
  ok(Math.abs(w1 - w0 - GROW) <= 12, `dragging the right edge: ${Math.round(w0)} → ${Math.round(w1)} px`);
  await page.click(`[data-spec-panel] button[aria-label="${UI.collapseSpec}"]`);
  await sleep(250);
  const folded = (await (await page.$("[data-spec-panel]")).boundingBox()).width;
  await gotoReady(page, page.url());
  await page.waitForSelector("[data-spec-panel]");
  await sleep(400);
  const reloaded = (await (await page.$("[data-spec-panel]")).boundingBox()).width;
  await page.click(`[data-spec-panel] button[aria-label="${UI.openSpec}"]`);
  await sleep(250);
  const unfolded = (await (await page.$("[data-spec-panel]")).boundingBox()).width;
  ok(folded <= 48 && reloaded <= 48 && Math.abs(unfolded - w1) <= 4, `fold → ${Math.round(folded)} px, still folded after a reload (${Math.round(reloaded)} px), unfold → ${Math.round(unfolded)} px`);

  // ── /spec page ──
  await gotoReady(page, `${STUDIO}/spec?e=${encodeURIComponent(ENTRY)}&k=behavior`);
  await page.waitForSelector("[data-toc] [data-page]", { timeout: 30_000 });
  const items = await page.$$eval("[data-toc] [data-page]", (bs) => bs.map((b) => b.getAttribute("data-page")));
  await page.evaluate((t) => document.querySelector(`[data-toc] [data-page="${t}"]`)?.click(), items[2]);
  await sleep(300);
  const a = await page.evaluate(() => document.querySelector("[data-spec-page]")?.getAttribute("data-spec-page"));
  await page.goBack();
  await sleep(400);
  const b = await page.evaluate(() => ({ n: document.querySelectorAll("[data-spec-page]").length, cur: document.querySelector("[data-spec-page]")?.getAttribute("data-spec-page") }));
  ok(a === items[2] && b.n === 1 && b.cur === items[0], `/spec: ${items.length} pages in the table of contents; pick one, Back → the first page again`);
  await page.close();

  // ── No source repository: /__src serves nothing ──
  const codes = await Promise.all(["src/main.ts", "../craft-table.json", "versions/index.json"].map((p) => fetch(`${STUDIO}/__src?path=${encodeURIComponent(p)}`).then((r) => r.status)));
  ok(codes.every((c) => c === 404), `no source repository configured → /__src answers 404 (${codes.join(", ")})`);
});
