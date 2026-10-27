// e2e: the Settings — the size of the desktop frames of the project.
//   • the gear in the sidebar's foot opens them; the current size is ticked (1280 × 800 when the project says nothing)
//   • picking Full HD and saving: every desktop frame is 1920 px wide, craft-table.json says so, the project API says so;
//     a reload keeps it; a second page open at the same time follows without a reload
//   • the command line's frame shots (studio/chat.mjs shot) use the project's size too
//   • a custom size outside the limits is refused on the page, nothing changes
//   • the console stays clean. At the end the project's craft-table.json is put back byte for byte.
// Screenshot: tests/shots/settings-1280.png
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DESKTOP, PROJECT, STUDIO, gotoReady, newPage, ok, projectFile, run, shot, sleep, studioUrl, until } from "./lib/e2e.mjs";

const A = "screens/tasks/list";
const widths = (page) => page.$$eval("[data-frame]", (els) => [...new Set(els.map((e) => Math.round(parseFloat(e.style.width))))].sort((a, b) => a - b));
const put = (body) => fetch(`${STUDIO}/__api/project/desktop`, { method: "PUT", headers: { "content-type": "application/json", origin: STUDIO }, body: JSON.stringify(body) });

await run("settings", async ({ browser, cleanup }) => {
  const file = projectFile("craft-table.json");
  const original = fs.readFileSync(file);
  cleanup("craft-table.json put back", async () => { await put({ reset: true }); fs.writeFileSync(file, original); });
  const problems = [];
  const page = await newPage(browser, DESKTOP);
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|Failed to load resource|favicon/.test(m.text())) problems.push(`console: ${m.text()}`); });

  await gotoReady(page, studioUrl({ e: A }));
  await page.waitForSelector("[data-frame]", { timeout: 15_000 });
  ok(JSON.stringify(await widths(page)) === "[390,1280]", `before: desktop frames 1280 wide, phones 390 (${await widths(page)})`);

  // ── Open, pick Full HD, save ──
  await page.click("[data-open-settings]");
  await page.waitForSelector("[data-settings]", { timeout: 5_000 });
  ok((await page.$eval('[data-desktop-option="1280x800"]', (el) => el.getAttribute("aria-checked"))) === "true", "the current size is ticked (1280 × 800)");
  const second = await newPage(browser, DESKTOP);
  await gotoReady(second, studioUrl({ e: A }));
  await second.waitForSelector("[data-frame]", { timeout: 15_000 });
  await page.bringToFront(); // a background tab is not painted: clicks and shots there can hang
  await page.click('[data-desktop-option="1920x1080"]');
  await shot(page, "settings-1280");
  await page.evaluate(() => { window.__noReload = true; });
  await page.click("[data-settings-save]");
  await until(async () => (await page.$("[data-settings]")) === null, "the dialog closed");
  await until(async () => JSON.stringify(await widths(page)) === "[390,1920]", "the desktop frames are Full HD wide");
  ok(true, "after saving, every desktop frame is 1920 px wide");
  ok(await page.evaluate(() => window.__noReload === true), "saving does not reload the page (what people were typing stays)");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  ok(raw.desktop?.width === 1920 && raw.desktop?.height === 1080 && raw.name === JSON.parse(original).name, `craft-table.json keeps its keys and says 1920 × 1080 (${JSON.stringify(raw.desktop)})`);
  const api = await fetch(`${STUDIO}/__api/project`).then((r) => r.json());
  ok(api.desktop.width === 1920 && api.desktop.height === 1080, "the project API says so");
  await second.bringToFront();
  await until(async () => JSON.stringify(await widths(second)) === "[390,1920]", "the other page followed");
  ok(true, "another page open at the same time follows without a reload");
  await second.close();
  await page.bringToFront();
  await gotoReady(page, studioUrl({ e: A }));
  await page.waitForSelector("[data-frame]", { timeout: 15_000 });
  ok(JSON.stringify(await widths(page)) === "[390,1920]", "a reload keeps it");

  // ── The command line shoots frames at the project's size too ──
  const png = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ct-settings-")), "shot.png");
  cleanup("command-line shot", () => fs.rmSync(path.dirname(png), { recursive: true, force: true }));
  execFileSync(process.execPath, [path.resolve(import.meta.dirname, "..", "studio", "chat.mjs"), "shot", A, "-", "desktop", png], { env: { ...process.env, CRAFT_PROJECT: PROJECT, STUDIO_URL: STUDIO }, stdio: "pipe", timeout: 120_000 });
  const shotWidth = fs.readFileSync(png).readUInt32BE(16); // PNG IHDR width
  ok(shotWidth === 1920, `chat.mjs shot takes a desktop frame 1920 wide (${shotWidth})`);

  // ── A custom size outside the limits ──
  await page.click("[data-open-settings]");
  await page.waitForSelector("[data-settings]", { timeout: 5_000 });
  ok((await page.$eval('[data-desktop-option="1920x1080"]', (el) => el.getAttribute("aria-checked"))) === "true", "reopened: Full HD is ticked");
  await page.click('[data-desktop-option="custom"]');
  await page.click("[data-desktop-width]", { count: 3 });
  await page.type("[data-desktop-width]", "500");
  await page.click("[data-settings-save]");
  await page.waitForSelector("[data-settings-error]", { timeout: 5_000 });
  ok((await page.$("[data-settings]")) !== null, "a width of 500 is refused, the dialog stays open with the reason");
  const bad = await put({ width: 500, height: 1080 });
  ok(bad.status === 400, `the server refuses it too (${bad.status})`);
  await page.keyboard.press("Escape");
  await page.click('[data-settings] [aria-label]');
  await sleep(300);
  ok(JSON.parse(fs.readFileSync(file, "utf8")).desktop.width === 1920, "nothing changed");
  ok(problems.length === 0, `the browser console stayed clean (${problems.slice(0, 3).join(" | ")})`);
});
