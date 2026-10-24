// e2e: every spec page renders — both tabs (Behavior, Technical) of every screen in every version, opened as the
// full page (/spec?…&p=all). What the page must show is worked out from the spec's markdown (tests/lib/spec-check.mjs):
// every section with its heading, and as many drawn diagrams as the markdown has ```mermaid blocks. Fails on a page
// that never shows the spec, a missing section, a diagram left as code or never drawn, markdown that did not render
// (**, ##, |---, ```, ](…) left in the text), a code embed that could not load, or a script error. Prints each place
// with the text around it. Arguments: [behavior|tech|all] (default all).
import { UI, entries, newPage, ok, run, sleep, STUDIO, versions } from "./lib/e2e.mjs";
import { expectedSpec, specProblems } from "./lib/spec-check.mjs";

const arg = process.argv[2] ?? "all";
const KINDS = arg === "all" ? ["behavior", "tech"] : [arg];

await run("spec-markdown", async ({ browser }) => {
  const page = await newPage(browser);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  let scanned = 0;
  let diagrams = 0;
  const broken = [];
  for (const { id: v } of (await versions()).versions) {
    for (const { id } of await entries(v)) {
      for (const k of KINDS) {
        const r = await fetch(`${STUDIO}/__api/spec?v=${v}&entry=${encodeURIComponent(id)}&kind=${k}`);
        if (!r.ok) continue;
        const want = expectedSpec((await r.json()).markdown ?? "");
        scanned++;
        diagrams += want.diagrams;
        errors.length = 0;
        const issues = [];
        await page.goto(`${STUDIO}/spec?v=${v}&e=${encodeURIComponent(id)}&k=${k}&p=all`, { waitUntil: "domcontentloaded" });
        // Every section on the page, then every diagram settled (svg in place, or marked as an error) — or the page
        // says it has nothing to show (checked below). A page that never gets there is a failure, reported with what
        // it shows.
        await page.waitForFunction((n, empty) => (document.querySelectorAll("[data-spec-page]").length >= n
          && [...document.querySelectorAll("figure.mmd")].every((f) => f.querySelector("svg") || f.classList.contains("mmd-err")))
          || (document.querySelector("main")?.innerText ?? "").includes(empty), { timeout: 60_000 }, want.pages.length, UI.specEmpty)
          .catch(() => issues.push(`never finished rendering within 60 s (${want.pages.length} sections, ${want.diagrams} diagrams expected)`));
        await sleep(300);
        const seen = await page.evaluate(() => ({
          pages: [...document.querySelectorAll("[data-spec-page]")].map((s) => ({
            id: s.getAttribute("data-spec-page"),
            title: s.querySelector("h2")?.textContent ?? "",
            figures: s.querySelectorAll("figure.mmd").length,
            drawn: s.querySelectorAll("figure.mmd svg").length,
          })),
          text: (document.querySelector("main") ?? document.getElementById("root"))?.innerText ?? "",
          dom: [
            ...[...document.querySelectorAll("figure.mmd.mmd-err")].map((f) => `broken diagram: ${f.querySelector("figcaption")?.textContent.slice(0, 120)}`),
            ...[...document.querySelectorAll(".src-err")].map((e) => `code embed: ${e.textContent.slice(0, 120)}`),
            ...(window.__specErrors ?? []).map((e) => `diagram error: ${String(e).slice(0, 120)}`),
          ],
        }));
        issues.push(...specProblems(want, seen), ...seen.dom, ...errors.map((e) => `script error: ${e.slice(0, 160)}`));
        if (issues.length) { broken.push(`${v} ${id} [${k}]`); console.log(`✗ ${v} ${id} [${k}]\n   ${issues.join("\n   ")}`); }
      }
    }
  }
  ok(scanned > 0, `found spec pages to check (${scanned})`);
  ok(diagrams > 0, `the specs have diagrams to draw (${diagrams})`);
  ok(broken.length === 0, `${scanned} spec pages show every section and draw all ${diagrams} diagrams${broken.length ? ` — broken: ${broken.join(", ")}` : ""}`);
  await page.close();
});
