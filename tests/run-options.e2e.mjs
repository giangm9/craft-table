// e2e: the model and the effort of the next turn are picked in the message box.
//   • the studio offers a short list of models and the five effort levels (/__api/project); "default" is the first choice
//   • a new conversation: pick a model and an effort, send → the thread is created with them (runWith)
//   • an open conversation: changing a picker saves at once (PATCH), a reload keeps it, "default" clears just that one
//   • the next NEW conversation starts from the last choice made for a new one
//   • an unknown model or effort is refused by the server; the browser console stays clean
// The send is made with the studio's noAgent switch on — nothing reaches Claude.
// Screenshot: tests/shots/run-options-1280.png
import { DESKTOP, STUDIO, UI, api, gotoReady, newPage, ok, run, shot, sleep, studioUrl, until } from "./lib/e2e.mjs";

const A = "screens/tasks/list";
const PANEL = "[data-panel]";
const TA = `${PANEL} [data-composer] textarea`;
const MODEL = `${PANEL} [data-run-model]`, EFFORT = `${PANEL} [data-run-effort]`;
const MARK = "E2E run options";

await run("run-options", async ({ browser, cleanup }) => {
  const problems = [];
  const page = await newPage(browser, DESKTOP);
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|Failed to load resource|favicon/.test(m.text())) problems.push(`console: ${m.text()}`); });
  await page.setRequestInterception(true);
  const created = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/__api/threads")) {
      const body = JSON.parse(r.postData() ?? "{}");
      created.push(body);
      return r.continue({ postData: JSON.stringify({ ...body, noAgent: true }) });
    }
    return r.continue();
  });
  cleanup("conversations made by the page", async () => {
    for (const t of (await api("GET", `/__api/threads?entry=${encodeURIComponent("*")}`)).threads) if (t.messages[0]?.text.startsWith(MARK)) await api("DELETE", `/__api/threads/${t.id}`);
  });
  const options = (sel) => page.$$eval(`${sel} option`, (os) => os.map((o) => [o.value, o.textContent.trim()]));
  const stored = async () => (await api("GET", "/__api/threads?entry=*")).threads.find((t) => t.messages[0]?.text.startsWith(MARK));

  // ── What the studio offers ──
  const project = await fetch(`${STUDIO}/__api/project`).then((r) => r.json());
  ok(project.agent.efforts.join() === "low,medium,high,xhigh,max", `five effort levels (${project.agent.efforts.join(", ")})`);
  ok(project.agent.models.length >= 3 && project.agent.models.every((m) => m.id && m.label), `a short list of models (${project.agent.models.map((m) => m.label).join(", ")})`);

  // ── A new conversation: pick, send ──
  await gotoReady(page, studioUrl({ e: A, t: "new" }));
  await page.waitForSelector(MODEL, { timeout: 10_000 });
  const models = await options(MODEL), efforts = await options(EFFORT);
  ok(models[0][0] === "" && models[0][1].startsWith(UI.runDefault) && models.length === project.agent.models.length + 1, `the model picker starts with "default" and lists the models (${models.map((m) => m[1]).join(" | ")})`);
  ok(efforts[0][0] === "" && efforts[0][1] === "Effort: default" && efforts.slice(1).map((e) => e[0]).join() === "low,medium,high,xhigh,max", `the effort picker starts with "default" and lists the five levels (${efforts.map((e) => e[1]).join(" | ")})`);
  ok(await page.$eval(MODEL, (el) => el.value) === "" && await page.$eval(EFFORT, (el) => el.value) === "", "nothing chosen = the studio's default");
  await page.select(MODEL, "claude-opus-5-5");
  await page.select(EFFORT, "high");
  await page.type(TA, `${MARK}: tighter`);
  // The bottom toolbar (Mark, @, Image, the pickers, expand, Send) is one wrapping block under the text box: on a narrow panel the
  // pickers drop to its second line, on a wide one everything is on one line.
  const placed = await page.evaluate(() => {
    const ta = document.querySelector("[data-panel] [data-composer] textarea");
    const sel = document.querySelector("[data-panel] [data-composer] [data-run-options]");
    const send = [...document.querySelectorAll("[data-panel] [data-composer] button")].find((b) => b.textContent.trim() === "Send");
    const bar = send?.parentElement?.parentElement;
    return !!sel && !!bar && bar.contains(sel) && sel.getBoundingClientRect().top >= ta.getBoundingClientRect().bottom;
  });
  ok(placed, "the pickers are in the bottom toolbar, under the text box, in the same block as Mark, @, Image and Send");
  await shot(page, "run-options-1280");
  await page.keyboard.press("Enter");
  await until(() => created.length === 1, "the conversation was created");
  ok(JSON.stringify(created[0].runWith) === JSON.stringify({ model: "claude-opus-5-5", effort: "high" }), `the page sends the choice (${JSON.stringify(created[0].runWith)})`);
  let mine;
  await until(async () => (mine = await stored()), "the server stored the conversation");
  ok(mine.runWith?.model === "claude-opus-5-5" && mine.runWith?.effort === "high", `the conversation keeps it (${JSON.stringify(mine.runWith)})`);

  // ── In the open conversation ──
  await page.waitForSelector(MODEL, { timeout: 10_000 });
  ok((await page.$eval(MODEL, (el) => el.value)) === "claude-opus-5-5" && (await page.$eval(EFFORT, (el) => el.value)) === "high", "the pickers show the conversation's choice");
  await page.select(EFFORT, "max");
  await until(async () => (await stored()).runWith?.effort === "max", "the effort was saved");
  ok((await stored()).runWith.model === "claude-opus-5-5", "changing the effort leaves the model alone");
  await gotoReady(page, studioUrl({ e: A, t: mine.id }));
  await page.waitForSelector(EFFORT, { timeout: 10_000 });
  ok((await page.$eval(EFFORT, (el) => el.value)) === "max" && (await page.$eval(MODEL, (el) => el.value)) === "claude-opus-5-5", "after a reload the choice is still there");
  await page.select(MODEL, "");
  await until(async () => !(await stored()).runWith?.model, "the model went back to default");
  ok(JSON.stringify((await stored()).runWith) === JSON.stringify({ effort: "max" }), `"default" clears just that one (${JSON.stringify((await stored()).runWith)})`);

  // ── The next new conversation starts from the last choice made for a new one ──
  await gotoReady(page, studioUrl({ e: A, t: "new" }));
  await page.waitForSelector(MODEL, { timeout: 10_000 });
  ok((await page.$eval(MODEL, (el) => el.value)) === "claude-opus-5-5" && (await page.$eval(EFFORT, (el) => el.value)) === "high", "a new conversation starts from the last choice made for a new one");

  // ── The server refuses what is not offered ──
  const bad = (body) => fetch(`${STUDIO}/__api/threads/${mine.id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: STUDIO }, body: JSON.stringify(body) }).then(async (r) => [r.status, (await r.json()).code]);
  const m = await bad({ runWith: { model: "gpt-9" } }), e = await bad({ runWith: { effort: "turbo" } });
  ok(m[0] === 400 && m[1] === "apiBadRunModel", `an unknown model is refused (${m})`);
  ok(e[0] === 400 && e[1] === "apiBadRunEffort", `an unknown effort is refused (${e})`);
  ok(JSON.stringify((await stored()).runWith) === JSON.stringify({ effort: "max" }), "a refused change leaves the thread as it was");

  await sleep(200);
  ok(problems.length === 0, `the browser console stayed clean (${problems.slice(0, 3).join(" | ")})`);
});
