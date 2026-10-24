// e2e: every board renders — each scenario of each board of every version, opened alone as /frame?v=&e=&s= at the
// widths the board declares (desktop 1280, mobile 390). Fails on a script error or console error (React warnings
// included), a compile error strip, an empty page, the "no such board" message, or a page wider than the phone.
// Screenshots: tests/shots/boards-<version>-<board>-<scenario>-<width>.png
import { api, newPage, ok, run, shot, sleep, STUDIO, versions } from "./lib/e2e.mjs";

const WIDTH = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844, isMobile: true, hasTouch: true } };
const slug = (s) => s.replace(/[^a-z0-9-]+/gi, "_");

await run("boards", async ({ browser }) => {
  const bad = [];
  let opened = 0;
  for (const { id: v } of (await versions()).versions) {
    const list = (await api("GET", `/__api/entries?v=${v}`)).entries;
    for (const e of list) {
      const scenarios = e.meta.scenarios?.length ? e.meta.scenarios.map((s) => s.id) : [null];
      for (const vp of e.meta.viewports ?? ["desktop", "mobile"]) {
        const page = await newPage(browser, WIDTH[vp]);
        const errors = [];
        page.on("pageerror", (err) => errors.push(`script error: ${err.message}`));
        // Failed requests are reported with their address by the "response" handler (the browser's own favicon
        // request does not count); every other console error does.
        page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`console: ${m.text()}`); });
        page.on("response", (r) => { const p = new URL(r.url()).pathname; if (r.status() >= 400 && p !== "/favicon.ico") errors.push(`HTTP ${r.status()} ${p}`); });
        for (const s of scenarios) {
          errors.length = 0;
          const url = `${STUDIO}/frame?v=${v}&e=${encodeURIComponent(e.id)}${s ? `&s=${encodeURIComponent(s)}` : ""}`;
          await page.goto(url, { waitUntil: "load" });
          await page.waitForFunction(() => (document.getElementById("root")?.innerText.trim().length ?? 0) > 0, { timeout: 60_000 }).catch(() => {});
          await sleep(400);
          const file = `/versions/${v}/boards/${e.id}.tsx`;
          const st = await page.evaluate((file) => ({
            text: document.getElementById("root")?.innerText.trim() ?? "",
            strip: document.querySelector("[data-board-error]")?.textContent ?? null,
            alert: document.querySelector("#root > [role=alert]")?.textContent ?? null,
            // The board module itself was fetched and answered 200 (otherwise the frame shows "no such board").
            loaded: performance.getEntriesByType("resource").some((r) => new URL(r.name).pathname === file && [200, 304].includes(r.responseStatus ?? 200)),
            overflow: document.documentElement.scrollWidth - innerWidth,
          }), file);
          const issues = [...errors];
          if (!st.text) issues.push("empty page");
          if (st.strip) issues.push(`compile error: ${st.strip.slice(0, 160)}`);
          if (st.alert) issues.push(`frame error: ${st.alert.slice(0, 160)}`);
          if (!st.loaded) issues.push(`board module ${file} did not load: ${st.text.slice(0, 120)}`);
          if (vp === "mobile" && st.overflow > 0) issues.push(`${st.overflow}px wider than the phone`);
          const where = `${v} ${e.id}${s ? ` · ${s}` : ""} · ${WIDTH[vp].width}`;
          opened++;
          await shot(page, `boards-${slug(v)}-${slug(e.id)}-${s ?? "_"}-${WIDTH[vp].width}`);
          if (issues.length) { bad.push(where); console.log(`✗ ${where}\n   ${issues.join("\n   ")}`); }
        }
        await page.close();
      }
    }
  }
  ok(opened > 0, `opened ${opened} board pages`);
  ok(bad.length === 0, `every board renders cleanly${bad.length ? ` — failing: ${bad.join(", ")}` : ""}`);
});
