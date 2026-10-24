// e2e: editing together — two pages open the same screen of the same version.
//   • spec editor (Edit mode): A types at the top → B sees the text and A's cursor; the .behavior.md file on disk
//     changes; the status line counts two people editing
//   • screen info form: A changes the description and adds a scenario → B sees both in its form and in its header;
//     the .meta.json file on disk changes
// Works in a throwaway copy of the live version, removed at the end. Screenshots: tests/shots/coedit-*.png
import fs from "node:fs";
import { DESKTOP, UI, boardFile, entries, gotoReady, newPage, ok, run, shot, sleep, studioUrl, tempVersion, until } from "./lib/e2e.mjs";

const ENTRY = "screens/tasks/list";
const TYPED = "A sentence typed by page A.";
const DESC = "A description typed by page A.";
const SCENARIO = "A scenario added by page A";

await run("coedit", async ({ browser, cleanup }) => {
  const title = (await entries()).find((e) => e.id === ENTRY).meta.title;
  const v = await tempVersion(cleanup, "E2E coedit");

  // ── Spec ──
  {
    const url = studioUrl({ v, e: ENTRY, spe: 1 });
    const A = await newPage(browser, DESKTOP), B = await newPage(browser, DESKTOP);
    await gotoReady(A, url);
    await gotoReady(B, url);
    const loaded = (p) => p.waitForFunction((t) => document.querySelector("[data-spec-panel] .cm-content")?.textContent.includes(t), { timeout: 15_000 }, title).then(() => true, () => false);
    ok((await loaded(A)) && (await loaded(B)), "the spec editor loads the spec on both pages");
    // A page in the background does not run IntersectionObserver (Puppeteer's click waits for it) → bring A forward.
    await A.bringToFront();
    await A.click("[data-spec-panel] .cm-content");
    // Type at the TOP: CodeMirror only draws the lines in view, so text at the end of a long spec is not in B's DOM.
    await A.keyboard.down("Control"); await A.keyboard.press("Home"); await A.keyboard.up("Control");
    await A.keyboard.type(`${TYPED}\n`);
    await B.bringToFront(); // a background tab does not redraw CodeMirror
    const seen = await B.waitForFunction((t) => document.querySelector("[data-spec-panel] .cm-content")?.textContent.includes(t), { timeout: 10_000 }, TYPED).then(() => true, () => false);
    const caret = await B.waitForFunction(() => document.querySelectorAll("[data-spec-panel] .cm-ySelectionCaret").length > 0, { timeout: 10_000 }).then(() => true, () => false);
    ok(seen && caret, `A types → B sees the text (${seen}) and A's cursor (${caret})`);
    const file = boardFile(v, `${ENTRY}.behavior.md`);
    await until(() => fs.readFileSync(file, "utf8").includes(TYPED), "the typed text in the file on disk", 10_000);
    ok(true, "what A typed is written to the .behavior.md file");
    const editors = await B.$eval("[data-editors]", (e) => Number(e.getAttribute("data-editors"))).catch(() => 0);
    ok(editors >= 2, `the status line counts ${editors} people editing`);
    await shot(B, "coedit-1280-spec");
    await A.close();
    await B.close();
  }

  // ── Screen info ──
  {
    const url = studioUrl({ v, e: ENTRY, meta: 1 });
    const A = await newPage(browser, DESKTOP), B = await newPage(browser, DESKTOP);
    await gotoReady(A, url);
    await gotoReady(B, url);
    const ready = (p) => p.waitForFunction((t) => (document.querySelector("[data-meta-editor] [data-meta-field='title']")?.value ?? "").includes(t), { timeout: 15_000 }, title).then(() => true, () => false);
    ok((await ready(A)) && (await ready(B)), "the screen info form loads on both pages");
    await A.bringToFront();
    await A.click("[data-meta-editor] [data-meta-field='desc']", { clickCount: 3 });
    await A.keyboard.down("Control"); await A.keyboard.press("a"); await A.keyboard.up("Control");
    await A.keyboard.type(DESC);
    await A.evaluate((t) => [...document.querySelectorAll("[data-meta-editor] button")].find((b) => b.textContent.includes(t))?.click(), UI.addScenario);
    await sleep(300);
    await A.focus("[data-meta-editor] li:last-child input");
    await A.keyboard.type(SCENARIO);
    await B.bringToFront();
    const seen = await B.waitForFunction((d, s) => document.querySelector("[data-meta-editor] [data-meta-field='desc']")?.value === d
      && [...document.querySelectorAll("[data-meta-editor] li input")].some((i) => i.value === s), { timeout: 10_000 }, DESC, SCENARIO).then(() => true, () => false);
    ok(seen, "A changes the description and adds a scenario → B sees both in its form");
    const file = boardFile(v, `${ENTRY}.meta.json`);
    let j = null;
    await until(() => {
      try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch { j = null; }
      return j?.desc === DESC && j.scenarios?.some((x) => x.title === SCENARIO);
    }, "the new description and scenario in the .meta.json file", 10_000);
    ok(true, `the .meta.json file has the new description and ${j.scenarios.length} scenarios`);
    const head = await B.waitForFunction((d) => document.querySelector("header")?.textContent.includes(d), { timeout: 10_000 }, DESC).then(() => true, () => false);
    ok(head, "B's header shows the new description");
    await shot(B, "coedit-1280-meta");
    await A.close();
    await B.close();
  }
});
