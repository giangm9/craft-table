// e2e: the model and the effort of the next turn, picked from the message box's tool row.
//   • the studio offers a short list of models and the five effort levels (/__api/project)
//   • the tool row: Mark, @, Image, the model / effort button, expand, Send — every control the same height and type size,
//     on one line, Send the only filled one
//   • the model / effort button opens a menu (Model: default + the models · Effort: default + five levels); a pick closes it and
//     shows on the button ("Opus 5.5 · High"); a new conversation is created with the choice (runWith)
//   • in an open conversation a pick is saved at once (PATCH) and survives a reload; "default" clears just that one
//   • the next NEW conversation starts from the last choice made for a new one
//   • an unknown model or effort is refused by the server; the browser console stays clean
// The send is made with the studio's noAgent switch on — nothing reaches Claude.
// Screenshots: tests/shots/run-options-1280.png (the row), run-options-menu-1280.png (the menu open)
import { DESKTOP, STUDIO, api, gotoReady, newPage, ok, run, shot, sleep, studioUrl, until } from "./lib/e2e.mjs";

const A = "screens/tasks/list";
const PANEL = "[data-panel]";
const TA = `${PANEL} [data-composer] textarea`;
const CHIP = `${PANEL} [data-run-chip]`, MENU = `${PANEL} [data-run-menu]`;
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
  const stored = async () => (await api("GET", "/__api/threads?entry=*")).threads.find((t) => t.messages[0]?.text.startsWith(MARK));
  const chipText = () => page.$eval(CHIP, (el) => el.textContent.trim());
  const pick = async (kind, value) => {
    await page.waitForSelector(CHIP, { timeout: 10_000 });
    await page.click(CHIP);
    await page.waitForSelector(MENU, { timeout: 5_000 });
    await page.click(`${MENU} [data-run-${kind}-option="${value}"]`);
    await until(async () => (await page.$(MENU)) === null, "the menu closed after the pick");
  };

  // ── What the studio offers ──
  const project = await fetch(`${STUDIO}/__api/project`).then((r) => r.json());
  ok(project.agent.efforts.join() === "low,medium,high,xhigh,max", `five effort levels (${project.agent.efforts.join(", ")})`);
  ok(project.agent.models.length >= 3 && project.agent.models.every((m) => m.id && m.label), `a short list of models (${project.agent.models.map((m) => m.label).join(", ")})`);

  // ── The tool row ──
  await gotoReady(page, studioUrl({ e: A, t: "new" }));
  await page.waitForSelector(CHIP, { timeout: 10_000 });
  const row = await page.evaluate(() => {
    const els = [...document.querySelectorAll("[data-panel] [data-composer-tools] > button, [data-panel] [data-run-chip]")];
    const box = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { h: Math.round(r.height), top: Math.round(r.top), font: cs.fontSize, filled: cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent", text: el.textContent.trim() }; };
    return els.map(box);
  });
  ok(row.length === 6, `the row has Mark, @, Image, the model / effort button, expand and Send (${row.length})`);
  ok(new Set(row.map((r) => r.h)).size === 1 && new Set(row.map((r) => r.font)).size === 1, `every control has the same height and type size (${[...new Set(row.map((r) => `${r.h}px/${r.font}`))].join(", ")})`);
  ok(Math.max(...row.map((r) => r.top)) - Math.min(...row.map((r) => r.top)) <= 1, "all on one line, on the default 360 px panel");
  ok(row.filter((r) => r.filled).map((r) => r.text).join() === "Send", `Send is the only filled control (${row.filter((r) => r.filled).map((r) => r.text || "icon").join(", ")})`);
  ok((await chipText()) === project.agent.defaultModel.label, `nothing chosen: the button shows the studio's default model ("${await chipText()}")`);
  await shot(page, "run-options-1280");

  // ── The menu ──
  await page.click(CHIP);
  await page.waitForSelector(MENU, { timeout: 5_000 });
  const menu = await page.evaluate(() => ({
    models: [...document.querySelectorAll("[data-run-menu] [data-run-model-option]")].map((b) => [b.getAttribute("data-run-model-option"), b.textContent.trim(), b.getAttribute("aria-checked")]),
    efforts: [...document.querySelectorAll("[data-run-menu] [data-run-effort-option]")].map((b) => [b.getAttribute("data-run-effort-option"), b.textContent.trim(), b.getAttribute("aria-checked")]),
  }));
  ok(menu.models.length === project.agent.models.length + 1 && menu.models[0][0] === "" && menu.models[0][2] === "true", `Model: "default" (checked) + the models (${menu.models.map((m) => m[1]).join(" | ")})`);
  ok(menu.efforts.map((e) => e[0]).join() === ",low,medium,high,xhigh,max" && menu.efforts[0][2] === "true", `Effort: "default" (checked) + five levels (${menu.efforts.map((e) => e[1]).join(" | ")})`);
  await shot(page, "run-options-menu-1280");
  await page.keyboard.press("Escape");
  await until(async () => (await page.$(MENU)) === null, "Esc closes the menu");

  // ── A new conversation ──
  await pick("model", "claude-opus-5-5");
  await pick("effort", "high");
  ok((await chipText()) === "Opus 5.5 · High", `the button shows the choice ("${await chipText()}")`);
  await page.type(TA, `${MARK}: tighter`);
  await page.keyboard.press("Enter");
  await until(() => created.length === 1, "the conversation was created");
  ok(JSON.stringify(created[0].runWith) === JSON.stringify({ model: "claude-opus-5-5", effort: "high" }), `the page sends the choice (${JSON.stringify(created[0].runWith)})`);
  let mine;
  await until(async () => (mine = await stored()), "the server stored the conversation");
  ok(mine.runWith?.model === "claude-opus-5-5" && mine.runWith?.effort === "high", `the conversation keeps it (${JSON.stringify(mine.runWith)})`);

  // ── In the open conversation ──
  // (the panel moves from the new-thread box to the conversation just made: wait for THAT one)
  const opened = await page.waitForFunction((id) => new URL(location.href).searchParams.get("t") === id && document.querySelector("[data-panel] [data-run-chip]")?.textContent.trim() === "Opus 5.5 · High", { timeout: 10_000 }, mine.id).then(() => true, () => false);
  ok(opened, "the conversation opens, and its button shows its choice");
  await pick("effort", "max");
  await until(async () => (await stored()).runWith?.effort === "max", "the effort was saved");
  ok((await stored()).runWith.model === "claude-opus-5-5", "changing the effort leaves the model alone");
  await gotoReady(page, studioUrl({ e: A, t: mine.id }));
  await page.waitForSelector(CHIP, { timeout: 10_000 });
  ok((await chipText()) === "Opus 5.5 · Max", `after a reload the choice is still there ("${await chipText()}")`);
  await pick("model", "");
  await until(async () => !(await stored()).runWith?.model, "the model went back to default");
  ok(JSON.stringify((await stored()).runWith) === JSON.stringify({ effort: "max" }), `"default" clears just that one (${JSON.stringify((await stored()).runWith)})`);

  // ── The next new conversation starts from the last choice made for a new one ──
  await gotoReady(page, studioUrl({ e: A, t: "new" }));
  await page.waitForSelector(CHIP, { timeout: 10_000 });
  ok((await chipText()) === "Opus 5.5 · High", `a new conversation starts from the last choice made for a new one ("${await chipText()}")`);

  // ── The server refuses what is not offered ──
  const bad = (body) => fetch(`${STUDIO}/__api/threads/${mine.id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: STUDIO }, body: JSON.stringify(body) }).then(async (r) => [r.status, (await r.json()).code]);
  const m = await bad({ runWith: { model: "gpt-9" } }), e = await bad({ runWith: { effort: "turbo" } });
  ok(m[0] === 400 && m[1] === "apiBadRunModel", `an unknown model is refused (${m})`);
  ok(e[0] === 400 && e[1] === "apiBadRunEffort", `an unknown effort is refused (${e})`);
  ok(JSON.stringify((await stored()).runWith) === JSON.stringify({ effort: "max" }), "a refused change leaves the thread as it was");

  await sleep(200);
  ok(problems.length === 0, `the browser console stayed clean (${problems.slice(0, 3).join(" | ")})`);
});
