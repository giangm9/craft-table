// e2e: the life of an option made from the studio's own dialog.
//   • "New option" on a screen, naming it and ticking a second screen of the same group → the studio opens the
//     option, the option bar says it is being tried, the screen list shows both options under their main screens,
//     and the option's files exist next to the main screens'
//   • the option's board is edited (as Claude would), then adopted → back on the main screen, which now has the
//     option's content; the main screen's info has no option field; the option is marked adopted; History records
//     the change as coming from the option
//   • the second screen's option is removed → its files are gone, the main screen stays, the screen list no longer
//     shows it
// Works in a throwaway copy of the live version, removed at the end. Screenshots: tests/shots/options-*.png
import fs from "node:fs";
import { OPTION_STATUSES } from "../studio/lib/option-meta.mjs";
import { optionId } from "../studio/lib/options.mjs";
import { DESKTOP, UI, api, boardFile, entries, gotoReady, newPage, ok, run, shot, sleep, studioUrl, tempVersion } from "./lib/e2e.mjs";

const MAIN = "screens/tasks/list";
const SIBLING = "screens/tasks/detail"; // same group as MAIN
const NAME = "Three buttons";
const [TRYING, ADOPTED] = OPTION_STATUSES;

await run("options-flow", async ({ browser, cleanup }) => {
  const meta = Object.fromEntries((await entries()).map((e) => [e.id, e.meta]));
  ok(meta[MAIN].group === meta[SIBLING].group, `${MAIN} and ${SIBLING} are in the same group (${meta[MAIN].group})`);
  const v = await tempVersion(cleanup, "E2E options");
  const OPT = optionId(MAIN, NAME), OPT2 = optionId(SIBLING, NAME);

  // ── Create ──
  const page = await newPage(browser, DESKTOP);
  await gotoReady(page, studioUrl({ v, e: MAIN }));
  await page.click(`button[aria-label="${UI.createOption}"]`);
  await page.waitForSelector("[data-option-name]", { timeout: 10_000 });
  await page.type("[data-option-name]", NAME);
  await page.evaluate((t) => [...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(t))?.querySelector("input")?.click(), meta[SIBLING].title);
  await sleep(200);
  await shot(page, "options-1280-new");
  await page.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t)?.click(), UI.create);
  const made = await page.waitForFunction((o, st, a, b) => new URLSearchParams(location.search).get("e") === o && document.querySelector(`[data-option-bar='${st}']`)
    && document.querySelector(`[data-option-of='${a}']`) && document.querySelector(`[data-option-of='${b}']`), { timeout: 15_000, polling: 150 }, OPT, TRYING, MAIN, SIBLING).then(() => true, () => false);
  const files = [`${OPT}.tsx`, `${OPT}.meta.json`, `${OPT2}.tsx`].every((f) => fs.existsSync(boardFile(v, f)));
  ok(made && files, `option "${NAME}" for two screens → the studio opens ${OPT}, the bar says "${TRYING}", both options are listed under their screens, their files exist (${files})`);
  await page.waitForFunction(() => [...document.querySelectorAll("iframe")].some((f) => f.contentDocument?.getElementById("root")?.children.length), { timeout: 30_000 }).catch(() => {});
  await sleep(500);
  await shot(page, "options-1280-option");

  // ── Edit, then adopt ──
  const optFile = boardFile(v, `${OPT}.tsx`);
  const src = fs.readFileSync(optFile, "utf8");
  ok(src.includes(">Team tasks</h1>"), "the option's board is a copy of the main screen's");
  fs.writeFileSync(optFile, src.replace(">Team tasks</h1>", ">Team tasks (option)</h1>"));
  await sleep(1200);
  await page.evaluate((t) => [...document.querySelectorAll("[data-option-bar] button")].find((b) => b.textContent.includes(t))?.click(), UI.adoptOption);
  await page.waitForFunction((t) => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === t), { timeout: 10_000 }, UI.adoptConfirm).catch(() => {});
  await page.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t)?.click(), UI.adoptConfirm);
  const back = await page.waitForFunction((e) => new URLSearchParams(location.search).get("e") === e && !document.querySelector("[data-option-bar]"), { timeout: 10_000, polling: 150 }, MAIN).then(() => true, () => false);
  const mainSrc = fs.readFileSync(boardFile(v, `${MAIN}.tsx`), "utf8");
  const mainMeta = JSON.parse(fs.readFileSync(boardFile(v, `${MAIN}.meta.json`), "utf8"));
  const optMeta = JSON.parse(fs.readFileSync(boardFile(v, `${OPT}.meta.json`), "utf8"));
  const revs = (await api("GET", `/__api/history?v=${v}&entry=${encodeURIComponent(MAIN)}`)).revisions ?? [];
  ok(back, "adopt → back on the main screen, no option bar");
  ok(mainSrc.includes("Team tasks (option)"), "the main screen now has the option's content");
  ok(!mainMeta.option, "the main screen's info has no option field");
  ok(optMeta.option?.status === ADOPTED, `the option is marked "${ADOPTED}" (${optMeta.option?.status})`);
  ok(revs.some((r) => r.source === "option" && r.path === `${MAIN}.tsx`), "History records the change as coming from the option");

  // ── Remove the second screen's option ──
  await gotoReady(page, studioUrl({ v, e: OPT2, opt: "remove" }));
  await page.waitForFunction((t) => [...document.querySelectorAll(".fixed button")].some((b) => b.textContent.trim() === t), { timeout: 10_000 }, UI.removeOption).catch(() => {});
  await page.evaluate((t) => [...document.querySelectorAll(".fixed button")].find((b) => b.textContent.trim() === t)?.click(), UI.removeOption);
  const removed = await page.waitForFunction((e) => new URLSearchParams(location.search).get("e") === e && !document.querySelector(`[data-option-of='${e}']`), { timeout: 10_000, polling: 150 }, SIBLING).then(() => true, () => false);
  ok(removed && !fs.existsSync(boardFile(v, `${OPT2}.tsx`)) && fs.existsSync(boardFile(v, `${SIBLING}.tsx`)), `remove ${OPT2} → its files are gone, ${SIBLING} stays, the screen list no longer shows the option`);
  await page.close();
});
