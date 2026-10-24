// e2e: the board's code pane under the canvas (code=1), edited together like the spec.
//   • it loads the board's code
//   • replacing a word in the JSX (search with Ctrl+F, Enter, Esc, type) changes the file on disk and the frames
//   • a syntax error shows in the frame (a strip at its bottom) and in the pane — never Vite's full-page error
//     overlay over the studio; fixing it brings the frames back
// Works in a throwaway copy of the live version, removed at the end. Screenshots: tests/shots/code-*.png
import fs from "node:fs";
import { DESKTOP, boardFile, gotoReady, newPage, ok, run, shot, studioUrl, tempVersion, until } from "./lib/e2e.mjs";

const ENTRY = "screens/tasks/list";
const FROM = "Team tasks", TO = "Our tasks"; // the page title of the board, unique in its code

await run("code-pane", async ({ browser, cleanup }) => {
  const v = await tempVersion(cleanup, "E2E code");
  const file = boardFile(v, `${ENTRY}.tsx`);
  const page = await newPage(browser, DESKTOP);
  await gotoReady(page, studioUrl({ v, e: ENTRY, vp: "desktop", code: 1 }));
  // CodeMirror only draws the lines in view: look for the imports at the top.
  const loaded = await page.waitForFunction(() => /\bimport\b/.test(document.querySelector("[data-code-editor] .cm-content")?.textContent ?? ""), { timeout: 15_000, polling: 150 }).then(() => true, () => false);
  ok(loaded, "the code pane loads the board's code");
  await page.waitForFunction(() => [...document.querySelectorAll("iframe")].every((x) => x.contentDocument?.getElementById("root")?.children.length), { timeout: 30_000 }).catch(() => {});
  const framesSay = (t) => page.waitForFunction((x) => [...document.querySelectorAll("iframe")].some((fr) => fr.contentDocument?.body?.innerText.includes(x)), { timeout: 10_000, polling: 200 }, t).then(() => true, () => false);
  ok(await framesSay(FROM), `the frames show "${FROM}"`);

  // ── Replace a word ──
  // Click near the top left of the visible code: the centre of .cm-content (the whole file) lies off screen.
  const sc = await page.$eval("[data-code-editor] .cm-scroller", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
  await page.mouse.click(sc.x + 120, sc.y + 12);
  await page.keyboard.down("Control"); await page.keyboard.press("f"); await page.keyboard.up("Control");
  await page.waitForSelector("[data-code-editor] input[name=search]", { timeout: 5000 });
  await page.type("[data-code-editor] input[name=search]", FROM);
  await page.keyboard.press("Enter"); // selects the match
  await page.keyboard.press("Escape"); // back to the code, the match still selected
  await page.keyboard.type(TO);
  const changed = await framesSay(TO);
  await until(() => fs.readFileSync(file, "utf8").includes(`>${TO}</h1>`), "the file on disk changed", 10_000).catch(() => {});
  ok(changed && fs.readFileSync(file, "utf8").includes(`>${TO}</h1>`), `typing in the code pane → the file and the frames say "${TO}"`);

  // ── Break it, then fix it ──
  await page.keyboard.type(" <<<");
  const errShown = await page.waitForFunction(() => document.querySelector("[data-code-error]") && [...document.querySelectorAll("iframe")].some((fr) => fr.contentDocument?.querySelector("[data-board-error]")), { timeout: 10_000, polling: 200 }).then(() => true, () => false);
  const overlay = await page.evaluate(() => !!document.querySelector("vite-error-overlay") || [...document.querySelectorAll("iframe")].some((fr) => fr.contentDocument?.querySelector("vite-error-overlay")));
  await shot(page, "code-1280-error");
  ok(errShown && !overlay, `a syntax error shows in the frame and in the code pane (${errShown}), no error overlay over the studio (${!overlay})`);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Backspace");
  const recovered = await page.waitForFunction(() => !document.querySelector("[data-code-error]") && ![...document.querySelectorAll("iframe")].some((fr) => fr.contentDocument?.querySelector("[data-board-error]")), { timeout: 10_000, polling: 200 }).then(() => true, () => false);
  ok(recovered && (await framesSay(TO)), "fixing it removes the error, the frames show the board again");
  await shot(page, "code-1280");
  await page.close();
});
