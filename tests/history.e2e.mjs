// e2e: history of a screen (right panel, History tab).
//   • a spec edited on disk, outside the studio, becomes a new revision once the file has been quiet for a while;
//     the first revision of the file (made when the version was created) is listed too
//   • opening an old revision shows what changed (lines added and removed) and puts it in the URL (hist)
//   • Restore → the file on disk gets the old content back, and a new revision records the restore
// Works in a throwaway copy of the live version, removed at the end. Screenshot: tests/shots/history-1280.png
import fs from "node:fs";
import { DESKTOP, UI, api, boardFile, gotoReady, newPage, ok, run, shot, sleep, studioUrl, tempVersion, until } from "./lib/e2e.mjs";

const ENTRY = "screens/tasks/list";

await run("history", async ({ browser, cleanup }) => {
  const v = await tempVersion(cleanup, "E2E history");
  const file = boardFile(v, `${ENTRY}.behavior.md`);
  const original = fs.readFileSync(file, "utf8");
  const heading = original.split("\n")[0];
  await sleep(500);
  fs.writeFileSync(file, original.replace(heading, `${heading} (edited by the history e2e test)`));
  // The recorder writes a revision once the file has not changed for 3 seconds.
  await until(async () => (await api("GET", `/__api/history?v=${v}&entry=${encodeURIComponent(ENTRY)}`)).revisions.some((r) => r.source === "external"), "a revision for the edit", 20_000);

  const page = await newPage(browser, DESKTOP);
  await gotoReady(page, studioUrl({ v, e: ENTRY, rp: "history" }));
  await page.waitForSelector("[data-rev]", { timeout: 15_000 });
  const revs = await page.$$eval("[data-rev]", (rs) => rs.map((r) => ({ id: r.getAttribute("data-rev"), src: r.getAttribute("data-source"), text: r.textContent })));
  const edit = revs.find((r) => r.src === "external"), init = revs.find((r) => r.src === "init" && r.text.includes(UI.behaviorTab));
  ok(!!edit && !!init, `History lists ${revs.length} revisions, among them the edit made outside the studio and the first revision of the ${UI.behaviorTab} spec`);

  await page.click(`[data-rev="${init.id}"]`);
  await page.waitForSelector("[data-diff]", { timeout: 10_000 });
  const d = await page.evaluate(() => ({ hist: new URLSearchParams(location.search).get("hist"), add: document.querySelectorAll("[data-diff='add']").length, del: document.querySelectorAll("[data-diff='del']").length }));
  ok(d.hist === init.id && d.add > 0 && d.del > 0, `opening revision #${init.id}: ${d.add} line(s) added, ${d.del} removed; URL hist=${d.hist}`);
  await shot(page, "history-1280");

  await page.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t)?.click(), UI.restore);
  await sleep(300);
  await page.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t)?.click(), UI.restoreConfirm);
  await until(() => fs.readFileSync(file, "utf8") === original, "the file gets its old content back");
  const last = (await api("GET", `/__api/history?v=${v}&entry=${encodeURIComponent(ENTRY)}`)).revisions[0];
  ok(last?.source === "restore", `Restore → the file has its old content again, and the newest revision records it (source "${last?.source}")`);
  await page.close();
});
