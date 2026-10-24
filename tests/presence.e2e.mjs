// e2e: who is where — two pages of the studio on two screens.
//   • each page shows a dot for the other one next to the screen it is on, and an avatar in the header
//   • B moves to a screen of another group: A's dot follows — on the screen's row when its group is open, on the
//     group's title when the group is folded (both are checked by folding / unfolding)
//   • clicking B's avatar in A's header takes A to B's screen
//   • B closes → its dot and avatar disappear
// Both pages are this machine ("claude@local"). Nothing is created. Screenshot: tests/shots/presence-1280.png
import { DESKTOP, UI, entries, gotoReady, newPage, ok, run, shot, sleep, studioUrl } from "./lib/e2e.mjs";

const A_AT = "screens/tasks/list";
const B_AT = "screens/tasks/detail";
const MOVE = "screens/settings"; // in another group than the two above

await run("presence", async ({ browser }) => {
  const meta = Object.fromEntries((await entries()).map((e) => [e.id, e.meta]));
  const groupKey = `${meta[MOVE].section}/${meta[MOVE].group}`;
  const waitDot = (p, id, want = true) => p.waitForFunction((i, w) => !!document.querySelector(`[data-presence-entry='${i}']`) === w, { timeout: 10_000, polling: 150 }, id, want).then(() => true, () => false);

  const A = await newPage(browser, DESKTOP), B = await newPage(browser, DESKTOP);
  await gotoReady(A, studioUrl({ e: A_AT }));
  await gotoReady(B, studioUrl({ e: B_AT }));
  await A.bringToFront();
  const aSees = await waitDot(A, B_AT);
  const aHead = await A.$eval("[data-presence]", (el) => Number(el.getAttribute("data-presence"))).catch(() => 0);
  await B.bringToFront();
  const bSees = await waitDot(B, A_AT);
  ok(aSees && bSees && aHead >= 1, `each page shows a dot for the other at its screen (A sees B at ${B_AT}: ${aSees}, B sees A at ${A_AT}: ${bSees}) and an avatar in the header (${aHead})`);

  // B moves to a screen of another group.
  await gotoReady(B, studioUrl({ e: MOVE }));
  await A.bringToFront();
  const GROUP = `[data-presence-group='${groupKey}']`;
  const where = () => A.evaluate((m, g) => ({ row: !!document.querySelector(`[data-presence-entry='${m}']`), grp: !!document.querySelector(g) }), MOVE, GROUP);
  await A.waitForFunction((m, g) => document.querySelector(`[data-presence-entry='${m}']`) || document.querySelector(g), { timeout: 10_000, polling: 150 }, MOVE, GROUP).catch(() => {});
  const w1 = await where();
  const left = await waitDot(A, B_AT, false);
  await A.evaluate((g) => [...document.querySelectorAll("aside:not([data-panel]) button")].find((x) => x.textContent.trim().startsWith(g))?.click(), meta[MOVE].group);
  await sleep(300);
  const w2 = await where();
  const both = (w1.row && !w1.grp && w2.grp && !w2.row) || (w1.grp && !w1.row && w2.row && !w2.grp);
  ok(left && both, `B moves → its dot leaves ${B_AT} and follows it to "${meta[MOVE].title}", on the row or on the folded group (${JSON.stringify(w1)} → ${JSON.stringify(w2)})`);
  await shot(A, "presence-1280");

  await A.click(`[data-presence] button[aria-label^='${UI.localUser}']`);
  const jumped = await A.waitForFunction((m) => new URLSearchParams(location.search).get("e") === m, { timeout: 5000, polling: 100 }, MOVE).then(() => true, () => false);
  ok(jumped, "clicking B's avatar in the header takes A to B's screen");

  await B.close();
  const gone = await A.waitForFunction((m, u) => !document.querySelector(`[data-presence-entry='${m}']`) && !document.querySelector(`[data-presence] button[aria-label^='${u}']`), { timeout: 10_000, polling: 150 }, MOVE, UI.localUser).then(() => true, () => false);
  ok(gone, "B closes → its dot and avatar disappear");
  await A.close();
});
