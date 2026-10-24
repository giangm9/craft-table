// e2e: the spec editor (Edit mode) previews markdown live — lines without the cursor hide their markdown symbols
// (# ** `) and "-" becomes "•"; the line being edited shows everything. Headings are bold and larger, not underlined;
// each list item stays on one line. Desktop (spec panel) and phone (spec sheet).
// What to expect is read from the spec itself (first heading, first two "- **Label**: …" items).
// Arguments: [version] [screen] (default: live version, screens/tasks/list). Screenshots: tests/shots/spec-editor-*.png
import { DESKTOP, PHONE, api, newPage, ok, run, shot, sleep, studioUrl, versions } from "./lib/e2e.mjs";

const V = process.argv[2] ?? (await versions()).live;
const ENTRY = process.argv[3] ?? "screens/tasks/list";

await run("spec-editor", async ({ browser }) => {
  const md = (await api("GET", `/__api/spec?v=${V}&entry=${encodeURIComponent(ENTRY)}&kind=behavior`)).markdown;
  const heading = /^# (.+)$/m.exec(md)[1];
  // First two list items that start with a bold label: the first is checked as a hidden line, the second gets the cursor.
  const [first, second] = [...md.matchAll(/^- \*\*([^*]+)\*\*(.*)$/gm)];
  ok(first && second, `the spec has a heading ("${heading}") and two "- **Label**: …" items to look at`);
  const firstText = `${first[1]}${first[2].replace(/\*\*|`/g, "")}`; // as shown when not edited: no "- ", no "**"
  const visibleLines = (page) => page.evaluate(() => [...document.querySelectorAll(".cm-line")].filter((l) => l.getBoundingClientRect().width > 0).map((l) => l.textContent));

  for (const vp of [DESKTOP, PHONE]) {
    const w = vp.width;
    const page = await newPage(browser, vp);
    await page.goto(studioUrl({ v: V, e: ENTRY, spe: 1, spec: w < 500 ? 1 : null }), { waitUntil: "domcontentloaded" });
    await page.waitForFunction((h) => [...document.querySelectorAll(".cm-line")].some((l) => l.textContent.includes(h) && l.getBoundingClientRect().width > 0), {}, heading);
    await sleep(1200);
    // Click the second item → the cursor (the line being edited) is there.
    const target = await page.evaluateHandle((label) => [...document.querySelectorAll(".cm-line")].find((l) => l.textContent.includes(label) && l.getBoundingClientRect().width > 0), second[1]);
    await target.click();
    await sleep(500);
    const lines = await visibleLines(page);
    const h = lines.find((l) => l.includes(heading));
    const item = lines.find((l) => l.includes(first[1]) && l.includes(first[2].trim().slice(0, 20)));
    const editing = lines.find((l) => l.includes(second[1]));
    ok(h === heading, `${w}: the heading shows without "#" (${JSON.stringify(h)})`);
    ok(item?.startsWith("•") && !item.includes("**"), `${w}: the "${first[1]}" item shows a bullet and no ** (${item?.slice(0, 40)}…)`);
    ok(editing?.startsWith(`- **${second[1]}**`), `${w}: the line being edited shows its symbols (${editing?.slice(0, 24)}…)`);
    ok(item?.replace(/^•\s*/, "") === firstText, `${w}: the "${first[1]}" item is one whole line`);
    const st = await page.evaluate((text) => {
      const l = [...document.querySelectorAll(".cm-line")].find((x) => x.textContent === text);
      const s = [...l.querySelectorAll("span")].find((x) => x.textContent.trim().length > 3) ?? l;
      const body = [...document.querySelectorAll(".cm-line")].find((x) => x.textContent.startsWith("•"));
      return { decor: getComputedStyle(s).textDecorationLine, size: parseFloat(getComputedStyle(s).fontSize), weight: getComputedStyle(s).fontWeight, body: parseFloat(getComputedStyle(body).fontSize) };
    }, heading);
    ok(st.decor === "none" && st.size > st.body && Number(st.weight) >= 600, `${w}: the heading is bold and larger (${st.size}px > ${st.body}px), not underlined`);
    await shot(page, `spec-editor-${w}`);
    await page.close();
  }
});
