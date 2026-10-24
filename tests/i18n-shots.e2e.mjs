// e2e: the studio in English and in Vietnamese, photographed at 1280×800 and 390×780 so English texts that break the
// layout (wrapping, overflow, clipped labels) can be seen. English is what the example shows a
// fresh browser; Vietnamese is the ct_lang=vi cookie. On every view: no button, link, select or tab sticks out of the
// window (the canvas and an off-screen drawer aside), and the page itself does not scroll sideways. Buttons and tabs
// whose own text overflows them are listed (not a failure: some truncate on purpose) to look at in the shots.
// Views: home (a screen, its spec panel, the conversation panel), the spec sheet (phone), a thread with the composer,
// History, an option and its bar, the screen info form, /versions, /spec, the phone's drawer with the language switch,
// and home with the boards in their dark theme (th=dark; the studio's own page is always light).
// A thread (noAgent) and a throwaway version with an option are created, and removed at the end.
// Screenshots: tests/shots/i18n-<lang>-<view>-<width>.png
import { DESKTOP, LANG_COOKIE, PHONE, STUDIO, api, gotoReady, newPage, ok, run, shot, sleep, studioUrl, tempVersion } from "./lib/e2e.mjs";

const MAIN = "screens/tasks/list";
const R1 = { scenario: null, viewport: "desktop", rect: { x: 20, y: 20, w: 200, h: 60 }, texts: ["Add task"] };

/** (In the page) controls outside the window, buttons / tabs whose text overflows them, a page that scrolls sideways. */
function pageLayout() {
  const vw = innerWidth;
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const skip = (el) => el.closest("[data-canvas-bg]") || (() => { const a = el.closest("aside"); return a && a.getBoundingClientRect().right <= 0; })();
  const name = (el) => (el.getAttribute("aria-label") || el.textContent.trim() || el.tagName).slice(0, 40);
  const outside = [], clipped = [];
  for (const el of document.querySelectorAll("button, a, select, [role=tab], input, textarea")) {
    if (!visible(el) || skip(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.right > vw + 1) outside.push(`${name(el)} (${Math.round(r.left)}–${Math.round(r.right)})`);
    if ((el.tagName === "BUTTON" || el.getAttribute("role") === "tab") && el.scrollWidth > el.clientWidth + 1) clipped.push(`${name(el)} (${el.scrollWidth} > ${el.clientWidth})`);
  }
  return { outside, clipped, sideways: document.documentElement.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1 };
}

await run("i18n-shots", async ({ browser, cleanup }) => {
  const { thread } = await api("POST", "/__api/threads", { entry: MAIN, title: "Bigger add button", text: "Make this bigger [#1], it is hard to hit on a phone", refs: [R1], noAgent: true });
  cleanup(`thread ${thread.id}`, () => api("DELETE", `/__api/threads/${thread.id}`));
  await api("POST", `/__api/threads/${thread.id}/claude`, { text: "**Done:** the button is now 48 px tall [#1].\n\n- the label stays\n- the icon is larger\n\nShall I do the same on the detail screen?", refs: [{ ...R1, rect: { x: 30, y: 30, w: 180, h: 50 } }] });
  const v = await tempVersion(cleanup, "E2E screenshots");
  const [option] = (await api("POST", "/__api/options", { v, entries: [MAIN], name: "Compact rows" })).ids;

  const views = {
    1280: {
      home: { url: studioUrl({ e: MAIN }), wait: "[data-spec-panel]" },
      thread: { url: studioUrl({ e: MAIN, t: thread.id }), wait: "[data-panel] [data-composer]" },
      history: { url: studioUrl({ e: MAIN, rp: "history" }), wait: "[data-rev]" },
      option: { url: studioUrl({ v, e: option }), wait: "[data-option-bar]" },
      info: { url: studioUrl({ e: MAIN, meta: "1" }), wait: "[data-meta-editor]" },
      versions: { url: `${STUDIO}/versions`, wait: "[data-version-row]" },
      spec: { url: `${STUDIO}/spec?e=${encodeURIComponent(MAIN)}&k=behavior`, wait: "[data-spec-page]" },
      "home-dark": { url: studioUrl({ e: MAIN, th: "dark" }), wait: "[data-spec-panel]" },
    },
    390: {
      home: { url: studioUrl({ e: MAIN }), wait: "header" },
      "spec-sheet": { url: studioUrl({ e: MAIN, spec: "1" }), wait: "[data-spec-panel]" },
      thread: { url: studioUrl({ e: MAIN, t: thread.id, panel: "1" }), wait: "div[data-panel] [data-composer]" },
      history: { url: studioUrl({ e: MAIN, panel: "1", rp: "history" }), wait: "[data-rev]" },
      option: { url: studioUrl({ v, e: option }), wait: "[data-option-bar]" },
      info: { url: studioUrl({ e: MAIN, meta: "1" }), wait: "[data-meta-editor]" },
      versions: { url: `${STUDIO}/versions`, wait: "[data-version-row]" },
      spec: { url: `${STUDIO}/spec?e=${encodeURIComponent(MAIN)}&k=behavior`, wait: "[data-spec-page]" },
      drawer: { url: studioUrl({ e: MAIN, nav: "1" }), wait: "[data-sidebar-foot] select" },
    },
  };

  const bad = [];
  let n = 0;
  for (const lang of ["en", "vi"]) {
    for (const [width, list] of Object.entries(views)) {
      const ctx = await browser.createBrowserContext();
      const page = await newPage(ctx, width === "390" ? PHONE : DESKTOP);
      if (lang === "vi") await page.setCookie({ name: LANG_COOKIE, value: "vi", url: STUDIO });
      for (const [view, { url, wait }] of Object.entries(list)) {
        await gotoReady(page, url);
        await page.waitForSelector(wait, { timeout: 30_000 });
        await sleep(700); // drawers and sheets slide in, fonts settle
        const pageLang = await page.evaluate(() => document.documentElement.lang);
        const l = await page.evaluate(pageLayout);
        const name = `i18n-${lang}-${view}-${width}`;
        await shot(page, name);
        n++;
        const where = `${lang} ${view} ${width}`;
        if (pageLang !== lang) bad.push(`${where}: <html lang="${pageLang}">`);
        if (l.outside.length) bad.push(`${where}: outside the window: ${l.outside.join(", ")}`);
        if (l.sideways) bad.push(`${where}: the page scrolls sideways`);
        console.log(`  ${name}.png${l.clipped.length ? ` — text wider than its button: ${l.clipped.join(", ")}` : ""}`);
      }
      await ctx.close();
    }
  }
  ok(bad.length === 0, `${n} screenshots in English and Vietnamese, every control inside the window${bad.length ? `:\n   ${bad.join("\n   ")}` : ""}`);
});
