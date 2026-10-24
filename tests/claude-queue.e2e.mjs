// e2e: Claude works on one thread of a screen at a time; the others wait their turn.
// The states are faked on disk (threads/<id>.json) — no Claude runs:
//   • thread A "running", thread B "queued" → the thread list labels B as waiting its turn, and the spec panel says
//     Claude is editing this screen
//   • opening B shows the "waiting" box; its button takes B out of the queue (back to idle) and the box goes away
//   • A back to idle → the spec panel's strip goes away
// Both threads are deleted at the end. Screenshot: tests/shots/queue-1280.png
import fs from "node:fs";
import { DESKTOP, UI, api, gotoReady, newPage, ok, projectFile, run, shot, studioUrl, until } from "./lib/e2e.mjs";

const ENTRY = "screens/tasks/list";

await run("claude-queue", async ({ browser, cleanup }) => {
  const mk = async (title) => {
    const { thread } = await api("POST", "/__api/threads", { entry: ENTRY, title, text: "queue test", refs: [], noAgent: true });
    cleanup(`thread ${thread.id}`, () => api("DELETE", `/__api/threads/${thread.id}`));
    return thread;
  };
  const A = await mk("Queue test — running"), B = await mk("Queue test — waiting");
  const fileOf = (id) => projectFile("threads", `${id}.json`);
  const agentOf = (id) => JSON.parse(fs.readFileSync(fileOf(id), "utf8")).agent;
  const setAgent = (id, patch) => {
    const j = JSON.parse(fs.readFileSync(fileOf(id), "utf8"));
    j.agent = { ...j.agent, ...patch };
    fs.writeFileSync(fileOf(id), JSON.stringify(j, null, 2) + "\n");
  };
  setAgent(A.id, { state: "running", progress: "Editing the board…" });
  setAgent(B.id, { state: "queued", progress: "Waiting for Claude to finish another thread of this screen" });

  const page = await newPage(browser, DESKTOP);
  await gotoReady(page, studioUrl({ e: ENTRY }));
  const badge = await page.waitForFunction((t) => [...document.querySelectorAll("[data-panel] span")].some((s) => s.textContent.trim() === t), { timeout: 10_000, polling: 150 }, UI.queued).then(() => true, () => false);
  const busy = await page.waitForFunction((t) => document.querySelector("[data-claude-busy]")?.textContent.includes(t), { timeout: 10_000, polling: 150 }, UI.claudeBusy).then(() => true, () => false);
  ok(badge && busy, `the waiting thread is labelled "${UI.queued}" (${badge}); the spec panel says "${UI.claudeBusy}" (${busy})`);

  await gotoReady(page, studioUrl({ e: ENTRY, t: B.id }));
  await page.waitForSelector("[data-queued]", { timeout: 10_000 });
  await shot(page, "queue-1280");
  await page.evaluate((t) => [...document.querySelectorAll("[data-queued] button")].find((b) => b.textContent.includes(t))?.click(), UI.unqueue);
  await until(() => agentOf(B.id).state === "idle", "B back to idle");
  const boxGone = await page.waitForFunction(() => !document.querySelector("[data-queued]"), { timeout: 10_000, polling: 150 }).then(() => true, () => false);
  ok(boxGone, `"${UI.unqueue}" takes B out of the queue (idle) and its waiting box goes away`);

  setAgent(A.id, { state: "idle", progress: null });
  const cleared = await page.waitForFunction(() => !document.querySelector("[data-claude-busy]"), { timeout: 20_000, polling: 200 }).then(() => true, () => false);
  ok(cleared, "A idle again → the spec panel's strip goes away");
  await page.close();
});
