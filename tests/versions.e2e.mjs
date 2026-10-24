// e2e: versions — the version select in the header, the "changed" dot, comparing two versions, the /versions page.
//   • a copy of the live version (made through the API); one of its specs is edited on disk
//   • opening that version: the select shows it, every frame loads it (v=…), and the screen list marks the edited
//     screen as changed from the version it was copied from
//   • comparing with the live version doubles the frames: half of them load the live version
//   • /versions lists both versions
// The copy is removed at the end. Screenshots: tests/shots/versions-*.png
import fs from "node:fs";
import { DESKTOP, STUDIO, UI, boardFile, gotoReady, newPage, ok, run, shot, sleep, studioUrl, tempVersion, versions } from "./lib/e2e.mjs";

const ENTRY = "screens/tasks/list";

await run("versions", async ({ browser, cleanup }) => {
  const { live } = await versions();
  const v = await tempVersion(cleanup, "E2E versions");
  ok((await versions()).versions.some((x) => x.id === v && x.from === live), `a copy of "${live}" exists: ${v}`);
  fs.appendFileSync(boardFile(v, `${ENTRY}.behavior.md`), "\n<!-- edited by the versions e2e test -->\n");

  const page = await newPage(browser, DESKTOP);
  await gotoReady(page, studioUrl({ v, e: ENTRY }));
  await page.waitForFunction(() => document.querySelectorAll("iframe").length >= 2, { timeout: 30_000 });
  await page.waitForSelector(`[data-changed="${ENTRY}"]`, { timeout: 15_000 }).catch(() => {});
  await sleep(400);
  const vs = await page.evaluate((label) => ({
    sel: document.querySelector(`header select[aria-label="${label}"]`)?.value,
    frames: [...document.querySelectorAll("iframe")].map((x) => x.getAttribute("src")),
    changed: [...document.querySelectorAll("[data-changed]")].map((x) => x.getAttribute("data-changed")),
  }), UI.versionSelect);
  ok(vs.sel === v && vs.frames.length > 0 && vs.frames.every((x) => x.includes(`v=${v}`)), `the version select shows ${v}, and every frame (${vs.frames.length}) loads v=${v}`);
  ok(vs.changed.includes(ENTRY), `the screen list marks ${ENTRY} as changed (${JSON.stringify(vs.changed)})`);
  ok(vs.changed.length === 1, "and only that screen");
  await shot(page, "versions-1280-changed");

  await gotoReady(page, studioUrl({ v, e: ENTRY, cmp: live }));
  await page.waitForFunction((n) => document.querySelectorAll("iframe").length >= n, { timeout: 30_000 }, vs.frames.length * 2).catch(() => {});
  await sleep(600);
  const cmp = await page.$$eval("iframe", (fs) => fs.map((x) => x.getAttribute("src")));
  ok(cmp.length === vs.frames.length * 2 && cmp.filter((x) => x.includes(`v=${live}`)).length === vs.frames.length, `compared with ${live}: ${vs.frames.length} → ${cmp.length} frames, half of them from ${live}`);
  await shot(page, "versions-1280-compare");

  await gotoReady(page, `${STUDIO}/versions`);
  await page.waitForSelector("[data-version-row]", { timeout: 30_000 });
  const rows = await page.$$eval("[data-version-row]", (rs) => rs.map((r) => r.getAttribute("data-version-row")));
  ok(rows.includes(live) && rows.includes(v), `/versions lists ${rows.length} versions (${rows.join(", ")})`);
  await shot(page, "versions-1280-page");
  await page.close();
});
