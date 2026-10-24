// e2e: the studio speaks the viewer's language. The language is the ct_lang cookie, else the
// project's craft-table.json "language", else English (studio/lib/i18n.mjs).
//   • a fresh browser on the English example: <html lang="en">, no ct_lang cookie, the UI in English (composer, spec
//     tabs, panel tabs, the language switch itself)
//   • the switch in the sidebar foot → Vietnamese: the page reloads with ct_lang=vi, the UI is Vietnamese, a reload
//     keeps it; switching back gives English again (ct_lang=en)
//   • phone 390: the switch sits in the board-list drawer, wholly on screen; switching from there works the same way
//   • a project that says "language": "vi" opens in Vietnamese with no cookie — a second studio on a temporary copy
//     of the example (its own port, the runner's port + 1 or STUDIO_VI_PORT), stopped and removed at the end; a
//     ct_lang=en cookie still wins there
//   • an API error text follows the viewer's language: both cookies, no cookie (= the project's language), and from
//     the page after switching
// Nothing is created in the example project. Screenshots: tests/shots/lang-*.png
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import DATA from "../studio/lib/i18n/data.mjs";
import { DESKTOP, LANG_COOKIE, PHONE, PROJECT, STUDIO, UI_TEXTS, newPage, ok, run, shot, sleep, studioUrl, versions } from "./lib/e2e.mjs";
import { stopChild, studioEnv } from "./lib/runner.mjs";

const ENTRY = "screens/tasks/list";
const REPO = path.resolve(import.meta.dirname, "..");
const VI_PORT = Number(process.env.STUDIO_VI_PORT || Number(new URL(STUDIO).port || 80) + 1);
const VI_STUDIO = `http://127.0.0.1:${VI_PORT}`;
const SWITCH = "[data-sidebar-foot] select"; // LangSwitch (studio/src/i18n/LangSwitch.tsx)
/** Words of the sidebar head, by language (studio/src/i18n/shell.ts studioTagline). */
const TAGLINE = { en: "Design studio", vi: "Xưởng thiết kế" };

/** Open a studio page and wait until its panels are drawn (the board list, and the composer when `t=new`). */
async function open(page, url, { composer = false } = {}) {
  await page.goto(url, { waitUntil: "load" });
  await settled(page, { composer });
}
async function settled(page, { composer = false } = {}) {
  await page.waitForFunction((c) => document.querySelector("[data-sidebar-foot] select")
    && document.querySelectorAll("aside a[href^='?e=']").length > 0
    && (!c || document.querySelector("[data-panel] [data-composer] button")), { timeout: 120_000, polling: 200 }, composer);
  await sleep(400);
}

/** What the page shows that tells its language. */
const seen = (page) => page.evaluate((sw) => {
  const texts = (sel) => [...document.querySelectorAll(sel)].map((b) => b.textContent.trim());
  const s = document.querySelector(sw);
  return {
    lang: document.documentElement.lang,
    cookie: /(?:^|;\s*)ct_lang=([^;]*)/.exec(document.cookie)?.[1] ?? null,
    switch: s ? { label: s.getAttribute("aria-label"), value: s.value } : null,
    menu: document.querySelector("header button[aria-label]")?.getAttribute("aria-label") ?? null,
    tabs: texts("[role=tab]"),
    specTabs: texts("[data-spec-panel] button"),
    composer: texts("[data-panel] [data-composer] button"),
    sidebar: s?.closest("aside")?.innerText ?? "",
  };
}, SWITCH);

/** The page speaks `lang` (desktop: composer, spec tabs and panel tabs are on screen). */
function speaks(s, lang, { desktop = true } = {}) {
  const W = UI_TEXTS[lang];
  const checks = {
    "html lang": s.lang === lang,
    "language switch": s.switch?.label === W.language && s.switch?.value === lang,
    "sidebar tagline": s.sidebar.includes(TAGLINE[lang]),
    ...(desktop
      ? {
        "composer button": s.composer.includes(W.send),
        "spec tabs": s.specTabs.some((t) => t.startsWith(W.behaviorTab)) && s.specTabs.some((t) => t.startsWith(W.techTab)),
        "panel tabs": s.tabs.some((t) => t.startsWith(W.conversation)) && s.tabs.some((t) => t.startsWith(W.history)),
      }
      : { "menu button": s.menu === W.boardList }),
  };
  const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return { ok: bad.length === 0, why: bad.length ? `wrong: ${bad.join(", ")} — ${JSON.stringify({ ...s, sidebar: s.sidebar.slice(0, 200) })}` : "" };
}

/** Pick a language in the switch: the page writes the cookie and reloads. */
async function pick(page, lang, opts) {
  await Promise.all([page.waitForNavigation({ waitUntil: "load", timeout: 120_000 }), page.select(SWITCH, lang)]);
  await settled(page, opts);
}

/** POST /__api/versions with no title: refused (400) without creating anything → { status, error, code }. */
async function apiError(base, live, lang) {
  const r = await fetch(`${base}/__api/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(lang ? { Cookie: `${LANG_COOKIE}=${lang}` } : {}) },
    body: JSON.stringify({ from: live, title: "" }),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
const refused = (e, lang) => e.status === 400 && e.code === "versionTitleMissing" && e.error === DATA[lang].versionTitleMissing;

const portFree = (port) => new Promise((resolve) => {
  const s = net.connect(port, "127.0.0.1");
  s.once("connect", () => { s.destroy(); resolve(false); });
  s.once("error", () => resolve(true));
});

/**
 * A second studio on a temporary copy of the example whose craft-table.json says "language": "vi" (without the
 * example's runtime data and threads). Stopped, then removed, by the clean-ups. Returns once it answers.
 */
async function startViStudio(cleanup) {
  if (!(await portFree(VI_PORT))) throw new Error(`✗ port ${VI_PORT} is taken — stop what runs there, or set STUDIO_VI_PORT`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "craft-table-e2e-lang-"));
  cleanup("temporary vi project", () => fs.rmSync(tmp, { recursive: true, force: true }));
  const proj = path.join(tmp, "project"), home = path.join(tmp, "home");
  fs.cpSync(PROJECT, proj, { recursive: true, filter: (src) => !["data", "threads", "node_modules"].includes(path.relative(PROJECT, src).split(path.sep)[0]) });
  fs.mkdirSync(home);
  const cfgFile = path.join(proj, "craft-table.json");
  fs.writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgFile, "utf8")), language: "vi" }, null, 2) + "\n");
  const log = fs.openSync(path.join(tmp, "studio.log"), "w");
  const child = spawn(process.execPath, [path.join(REPO, "bin", "craft-table.mjs"), "start"], {
    cwd: proj, env: studioEnv(process.env, { project: proj, port: VI_PORT, home }), stdio: ["ignore", log, log], detached: true,
  });
  process.on("exit", () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); });
  cleanup("vi studio", () => stopChild(child, 15_000));
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`✗ the vi studio stopped while starting:\n${fs.readFileSync(path.join(tmp, "studio.log"), "utf8").slice(-1500)}`);
    try { if ((await fetch(`${VI_STUDIO}/__api/entries`)).ok) break; } catch { /* not listening yet */ }
    if (Date.now() - t0 > 180_000) throw new Error("✗ the vi studio did not answer within 3 minutes");
    await sleep(500);
  }
  console.log(`  (vi studio on ${VI_STUDIO} ready in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

await run("lang", async ({ browser, cleanup }) => {
  const { live } = await versions();

  // ── A fresh browser on the English example ──
  let ctx = await browser.createBrowserContext();
  let page = await newPage(ctx, DESKTOP);
  await open(page, studioUrl({ e: ENTRY, t: "new" }), { composer: true });
  let s = await seen(page);
  let r = speaks(s, "en");
  ok(r.ok && s.cookie === null, `1280, fresh browser: <html lang="${s.lang}">, no ${LANG_COOKIE} cookie, the UI is English ("${UI_TEXTS.en.send}", "${UI_TEXTS.en.behaviorTab}" / "${UI_TEXTS.en.techTab}") ${r.why}`);
  for (const p of ["/versions", "/spec"]) {
    const html = await (await fetch(`${STUDIO}${p}`)).text();
    ok(/<html[^>]*\blang="en"/.test(html), `${p} is served with <html lang="en"> to a viewer with no cookie`);
  }

  // ── Switch to Vietnamese, reload, switch back ──
  await pick(page, "vi", { composer: true });
  s = await seen(page);
  r = speaks(s, "vi");
  ok(r.ok && s.cookie === "vi", `1280: the switch → Vietnamese, cookie ${LANG_COOKIE}=${s.cookie} ("${UI_TEXTS.vi.send}", "${UI_TEXTS.vi.behaviorTab}" / "${UI_TEXTS.vi.techTab}", "${UI_TEXTS.vi.conversation}") ${r.why}`);
  await shot(page, "lang-1280-vi");
  const fromPage = await page.evaluate(async (from) => {
    const res = await fetch("/__api/versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, title: "" }) });
    return { status: res.status, ...(await res.json()) };
  }, live);
  ok(refused(fromPage, "vi"), `an API error read by the page after switching is Vietnamese ("${fromPage.error}")`);
  await page.reload({ waitUntil: "load" });
  await settled(page, { composer: true });
  s = await seen(page);
  r = speaks(s, "vi");
  ok(r.ok, `1280: a reload keeps Vietnamese ${r.why}`);
  for (const p of ["/versions", "/spec"]) {
    const html = await (await fetch(`${STUDIO}${p}`, { headers: { Cookie: `${LANG_COOKIE}=vi` } })).text();
    ok(/<html[^>]*\blang="vi"/.test(html), `${p} is served with <html lang="vi"> to a viewer with ${LANG_COOKIE}=vi`);
  }
  await pick(page, "en", { composer: true });
  s = await seen(page);
  r = speaks(s, "en");
  ok(r.ok && s.cookie === "en", `1280: switching back → English, cookie ${LANG_COOKIE}=${s.cookie} ${r.why}`);
  await ctx.close();

  // ── /versions and /spec have the switch too ──
  for (const p of ["/versions", `/spec?e=${encodeURIComponent(ENTRY)}`]) {
    ctx = await browser.createBrowserContext();
    page = await newPage(ctx, DESKTOP);
    await page.goto(`${STUDIO}${p}`, { waitUntil: "load" });
    const sel = 'select:has(option[value="en"]):has(option[value="vi"])';
    const has = await page.waitForSelector(sel, { timeout: 30_000 }).then(() => true, () => false);
    ok(has, `${p}: the page has the language switch`);
    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.select(sel, "vi")]);
    const after = await page.evaluate(() => ({ lang: document.documentElement.lang, cookie: document.cookie }));
    ok(after.lang === "vi" && after.cookie.includes(`${LANG_COOKIE}=vi`), `${p}: switching → <html lang="${after.lang}">, ${after.cookie}`);
    await shot(page, `lang-switch-${p.slice(1).split("?")[0]}-vi`);
    await ctx.close();
  }

  // ── API errors follow the viewer's language ──
  const en = await apiError(STUDIO, live, "en"), vi = await apiError(STUDIO, live, "vi"), none = await apiError(STUDIO, live, null);
  ok(refused(en, "en") && refused(vi, "vi") && refused(none, "en"), `API error: "${en.error}" (${LANG_COOKIE}=en), "${vi.error}" (${LANG_COOKIE}=vi), "${none.error}" (no cookie, English project)`);

  // ── Phone 390: the switch in the drawer ──
  ctx = await browser.createBrowserContext();
  page = await newPage(ctx, PHONE);
  await open(page, studioUrl({ e: ENTRY }));
  s = await seen(page);
  r = speaks(s, "en", { desktop: false });
  ok(r.ok, `390, fresh browser: English ("${UI_TEXTS.en.boardList}" menu) ${r.why}`);
  await page.click(`header button[aria-label="${UI_TEXTS.en.boardList}"]`);
  await page.waitForFunction(() => new URLSearchParams(location.search).get("nav") === "1", { timeout: 10_000 });
  await sleep(500); // the drawer slides in
  const onScreen = () => page.$eval(SWITCH, (el) => {
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width), vw: innerWidth, vh: innerHeight };
  });
  let box = await onScreen();
  ok(box.left >= 0 && box.right <= box.vw && box.top >= 0 && box.bottom <= box.vh && box.w >= 120, `390: the drawer shows the language switch wholly on screen (${JSON.stringify(box)})`);
  await shot(page, "lang-390-drawer-en");
  await pick(page, "vi");
  await sleep(500);
  s = await seen(page);
  r = speaks(s, "vi", { desktop: false });
  box = await onScreen();
  ok(r.ok && s.cookie === "vi" && box.left >= 0 && box.right <= box.vw, `390: switching in the drawer → Vietnamese ("${UI_TEXTS.vi.boardList}" menu, "${TAGLINE.vi}"), the drawer is still open ${r.why}`);
  await shot(page, "lang-390-drawer-vi");
  await pick(page, "en");
  s = await seen(page);
  r = speaks(s, "en", { desktop: false });
  ok(r.ok && s.cookie === "en", `390: and back to English from the drawer ${r.why}`);
  await ctx.close();

  // ── A Vietnamese project, no cookie ──
  await startViStudio(cleanup);
  const viNone = await apiError(VI_STUDIO, live, null), viEn = await apiError(VI_STUDIO, live, "en");
  ok(refused(viNone, "vi") && refused(viEn, "en"), `"language": "vi" project: API error "${viNone.error}" with no cookie, "${viEn.error}" with ${LANG_COOKIE}=en`);
  ctx = await browser.createBrowserContext();
  page = await newPage(ctx, DESKTOP);
  await open(page, `${VI_STUDIO}/?e=${encodeURIComponent(ENTRY)}&t=new`, { composer: true });
  s = await seen(page);
  r = speaks(s, "vi");
  ok(r.ok && s.cookie === null, `"language": "vi" project, fresh browser: Vietnamese with no cookie ${r.why}`);
  await shot(page, "lang-1280-vi-project");
  await page.evaluate((c) => { document.cookie = `${c}=en; Path=/; SameSite=Lax`; }, LANG_COOKIE);
  await page.reload({ waitUntil: "load" });
  await settled(page, { composer: true });
  s = await seen(page);
  r = speaks(s, "en");
  ok(r.ok, `"language": "vi" project: a ${LANG_COOKIE}=en cookie wins, the UI is English ${r.why}`);
  await ctx.close();
});
