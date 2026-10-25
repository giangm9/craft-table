// Screenshots for the studio's Claude (and chat.mjs): ONE shared Puppeteer browser, opened when needed, closed when idle.
// Each command opens a new page and always closes it (even on error / when stopped) — no page is left hanging.
//   frame   a frame of one scenario          region   exactly a mark's region (red outline + margin) + the text in it
//   locate  coordinates of the element holding a text   specPage  the spec page (all expanded) + broken diagrams / embeds
//   shrink  shrink an attached image too big for the API into a JPEG (canvas)
const WIDTH = { desktop: 1280, mobile: 390 };
const PAD = 32;
const MAX_H = 2000;

export function frameUrl(base, { version, entry, scenario, theme = "light" }) {
  return `${base}/frame?v=${version}&e=${encodeURIComponent(entry)}${scenario && scenario !== "-" ? `&s=${encodeURIComponent(scenario)}` : ""}&th=${theme}`;
}

/**
 * This browser calls the studio from 127.0.0.1, so it counts as "claude@local" (no sign-in, even the local-only APIs).
 * Boards written by Claude run in it → only GETs of exactly what builds the frame / spec of the VERSION being shot:
 * no writing API, no other version, no threads/ or data/, nothing outside.
 */
export function allowedRequest(urlStr, method, { origin, version, tool = "", externalOrigins = [] }) {
  if (method !== "GET") return false;
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  if (u.protocol === "data:" || u.protocol === "blob:") return true;
  // Sites the project lists (craft-table.json externalOrigins, e.g. an avatar service): blocked, Claude would see
  // a different picture from people.
  if (externalOrigins.includes(u.origin)) return true;
  if (u.origin !== origin) return false;
  const p = u.pathname;
  return p === "/frame" || p === "/spec" || p === "/@react-refresh" || p.startsWith("/@vite/") || p.startsWith("/@id/")
    || (p.startsWith("/@fs/") && p.includes("/node_modules/")) || p.startsWith("/node_modules/") || (tool && p.startsWith(`${tool}/studio/`))
    || p.startsWith(`/versions/${version}/`) || p === "/__api/spec" || p === "/__api/src" || p === "/__src" || p === "/__api/project"
    || (p === "/__api/entries" && u.searchParams.get("v") === version) // the /spec page reads the screen's title
    || p.startsWith("/fonts/") || p.startsWith("/icons/");
}

/** Chrome with the screenshot settings (tests pass their own `launch`). */
async function launchChrome() {
  const { default: puppeteer } = await import("puppeteer");
  // On a busy machine Chrome can take > 30 seconds to start → wait up to 2 minutes.
  // Background tabs are not painted → shooting a background tab hangs (2 turns at once). Turn off Chrome's
  // background-tab throttling.
  return puppeteer.launch({
    headless: true, timeout: 120_000, protocolTimeout: 180_000,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"],
  });
}

const LAUNCH_TRIES = 3;

// desktop: () => { w, h } — the project's desktop frame size, read at every shot (the Settings can change it while the studio runs).
export function createShots({ base, tool = "", externalOrigins = [], idleMs = 300_000, launch = launchChrome, retryDelayMs = 1000, desktop = () => ({ w: 1280, h: 800 }) }) {
  let browser = null, launching = null, timer = null, busy = 0;
  const api = { _launches: 0, _open: false };
  const origin = new URL(base).origin;

  async function getBrowser() {
    clearTimeout(timer);
    if (browser) return browser;
    // One launch shared by every waiting turn (2 turns at once do not open 2 Chromes).
    launching ??= (async () => {
      // Chrome sometimes dies as it starts on a busy machine (signal 11): start it again, up to LAUNCH_TRIES times.
      let b = null;
      for (let i = 1; !b; i++) {
        try { b = await launch(); } catch (e) {
          if (i >= LAUNCH_TRIES) throw e;
          await new Promise((r) => setTimeout(r, retryDelayMs * i));
        }
      }
      api._launches++; api._open = true;
      b.on("disconnected", () => { if (browser === b) { browser = null; api._open = false; } });
      browser = b;
      return b;
    })().finally(() => { launching = null; });
    return launching;
  }
  let chain = Promise.resolve();
  const exclusive = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };
  // Schedule the close only when NO page is in use (another turn may be shooting a spec page for minutes).
  const armIdle = () => { clearTimeout(timer); if (busy > 0) return; timer = setTimeout(() => { if (busy === 0) api.close(); }, idleMs); timer.unref?.(); };

  /** Open a page at the URL with the frame's width, run fn(page), always close the page. */
  async function withPage(viewport, url, fn, version, before = null) {
    busy++;
    let p = null;
    try {
      const b = await getBrowser();
      p = await b.newPage();
      await p.setRequestInterception(true);
      p.on("request", (r) => (allowedRequest(r.url(), r.method(), { origin, version, tool, externalOrigins }) ? r.continue() : r.abort("blockedbyclient")).catch(() => {}));
      const d = viewport === "desktop" ? desktop() : { w: WIDTH[viewport] ?? 390, h: 800 };
      await p.setViewport({ width: d.w, height: d.h });
      const errors = [];
      p.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
      before?.(p, errors); // listeners that must be in place before the page loads
      // The "built" signal is #root having content (the board loads dynamically after DOMContentLoaded) — not "load"
      // of every resource: a sluggish shared machine can hold "load" for a very long time after the board is drawn.
      await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await p.waitForFunction(() => document.getElementById("root")?.children.length, { timeout: 45_000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
      // Pages load in parallel; measuring + SHOOTING go one page at a time, the page brought to front (shooting a
      // background tab can hang).
      return await exclusive(async () => { await p.bringToFront(); return fn(p, errors); });
    } finally {
      await p?.close().catch(() => {});
      busy--;
      armIdle();
    }
  }

  api.frame = ({ version, entry, scenario, viewport = "desktop", part = "top" }) =>
    withPage(viewport, frameUrl(base, { version, entry, scenario }), async (p, errors) => {
      const h = await p.evaluate(() => document.documentElement.scrollHeight);
      const png = part === "full"
        ? await p.screenshot({ captureBeyondViewport: true, clip: { x: 0, y: 0, width: viewport === "desktop" ? desktop().w : WIDTH[viewport] ?? 390, height: Math.min(h, MAX_H) } })
        : await p.screenshot();
      return { png: Buffer.from(png), errors, height: h, width: viewport === "desktop" ? desktop().w : WIDTH[viewport] ?? 390 };
    }, version);

  // The Vite hot-reload socket and blocked requests are the studio's own noise, not a problem of the board.
  const NOISE = /WebSocket connection to|\[vite\] failed to connect|Failed to load resource|your current setup|\(browser\)|\(server\)|net::ERR_FAILED|blocked/;
  /**
   * Look at a frame the way a person would, and measure it: a picture (shot: false → none), the page height, every problem
   * the page reported (uncaught errors, console errors, requests that failed), whether the board itself failed to draw, and the
   * JSON result of `evalJs` — a JavaScript expression run INSIDE the page (e.g. a count or a size); it sees only that frame.
   */
  api.inspect = ({ version, entry, scenario, viewport = "desktop", theme = "light", part = "top", evalJs, shot = true }) =>
    withPage(viewport, frameUrl(base, { version, entry, scenario, theme }), async (p, errors) => {
      const height = await p.evaluate(() => document.documentElement.scrollHeight);
      const boardError = await p.evaluate(() => !!document.querySelector("[data-board-error]"));
      let value, evalError;
      if (evalJs) {
        try { value = await p.evaluate(`(async () => (${evalJs}))()`); } catch (e) { evalError = String(e?.message ?? e).slice(0, 300); }
      }
      let png = null;
      if (shot) {
        png = Buffer.from(part === "full"
          ? await p.screenshot({ captureBeyondViewport: true, clip: { x: 0, y: 0, width: viewport === "desktop" ? desktop().w : WIDTH[viewport] ?? 390, height: Math.min(height, MAX_H) } })
          : await p.screenshot());
      }
      return { png, errors: [...errors], height, boardError, value, evalError };
    }, version, (p, errors) => {
      p.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
      p.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`http ${r.status()}: ${r.url().replace(origin, "").slice(0, 160)}`); });
    });

  api.region = ({ version, entry, ref }) =>
    withPage(ref.viewport, frameUrl(base, { version, entry, scenario: ref.scenario }), async (p) => {
      const r = ref.rect;
      const texts = await p.evaluate((q) => {
        const out = [];
        for (const el of document.body.querySelectorAll("*")) {
          if ([...el.children].some((c) => (c.textContent ?? "").trim())) continue; // leaf elements with text only
          const t = (el.textContent ?? "").trim();
          if (!t) continue;
          const b = el.getBoundingClientRect(), x = b.left + scrollX, y = b.top + scrollY;
          if (x < q.x + q.w && x + b.width > q.x && y < q.y + q.h && y + b.height > q.y) out.push(t.slice(0, 80));
        }
        const d = document.createElement("div");
        Object.assign(d.style, { position: "absolute", left: q.x + "px", top: q.y + "px", width: q.w + "px", height: q.h + "px", outline: "2px solid #e11d48", zIndex: 99999, pointerEvents: "none" });
        document.body.appendChild(d);
        return out.slice(0, 30);
      }, r);
      const docW = await p.evaluate(() => document.documentElement.scrollWidth);
      const x = Math.max(0, r.x - PAD), y = Math.max(0, r.y - PAD);
      const png = await p.screenshot({ captureBeyondViewport: true, clip: { x, y, width: Math.min(docW - x, r.w + PAD * 2), height: r.h + PAD * 2 } });
      return { png: Buffer.from(png), texts };
    }, version);

  api.locate = ({ version, entry, scenario, viewport = "desktop", text }) =>
    withPage(viewport, frameUrl(base, { version, entry, scenario }), (p) => p.evaluate((needle) => {
      const n = needle.toLowerCase();
      const all = [...document.body.querySelectorAll("*")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (el.textContent ?? "").toLowerCase().includes(n);
      });
      // The smallest elements holding the text (no child holds it too).
      const leaves = all.filter((el) => ![...el.children].some((c) => (c.textContent ?? "").toLowerCase().includes(n) && c.getBoundingClientRect().width > 0));
      return leaves.slice(0, 5).map((el) => {
        const r = el.getBoundingClientRect();
        return { tag: el.tagName.toLowerCase(), text: (el.textContent ?? "").trim().slice(0, 60), x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
      });
    }, text), version);

  api.specPage = ({ version, entry, kind = "behavior" }) =>
    withPage("desktop", `${base}/spec?v=${version}&e=${encodeURIComponent(entry)}&k=${kind}&p=all`, async (p, errs) => {
      await p.waitForFunction(() => ![...document.querySelectorAll("figure.mmd")].some((f) => !f.querySelector("svg") && !f.classList.contains("mmd-err"))
        && ![...document.querySelectorAll(".src-embed")].some((e) => e.querySelector(".src-load")), { timeout: 30_000 }).catch(() => {});
      const report = await p.evaluate(() => ({
        diagrams: document.querySelectorAll("figure.mmd svg").length,
        badDiagrams: [...document.querySelectorAll("figure.mmd-err figcaption")].map((f) => f.textContent),
        embeds: document.querySelectorAll(".src-embed .src-body").length,
        badEmbeds: [...document.querySelectorAll(".src-embed .src-err")].map((f) => f.textContent),
        rules: document.querySelectorAll("[data-rule]").length,
      }));
      const h = await p.evaluate(() => document.documentElement.scrollHeight);
      const png = await p.screenshot({ captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1280, height: Math.min(h, MAX_H) } });
      return { png: Buffer.from(png), report: { ...report, errs } };
    }, version);

  /** Shrink an image (an attachment too big for the API) with a canvas: long side ≤ maxEdge, white background (transparent PNG), JPEG. */
  api.shrink = async (buf, { maxEdge = 1568, quality = 0.85 } = {}) => {
    busy++;
    let p = null;
    try {
      const b = await getBrowser();
      p = await b.newPage();
      const b64 = await p.evaluate(async (src, edge, q) => {
        const im = new Image();
        im.src = src;
        await im.decode();
        const k = Math.min(1, edge / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(im.naturalWidth * k);
        c.height = Math.round(im.naturalHeight * k);
        const g = c.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(im, 0, 0, c.width, c.height);
        return c.toDataURL("image/jpeg", q).split(",")[1];
      }, `data:image/png;base64,${Buffer.from(buf).toString("base64")}`, maxEdge, quality);
      return Buffer.from(b64, "base64");
    } finally {
      await p?.close().catch(() => {});
      busy--;
      armIdle();
    }
  };

  api.close = async () => {
    clearTimeout(timer);
    const b = browser;
    browser = null; api._open = false;
    await b?.close().catch(() => {});
  };
  return api;
}
