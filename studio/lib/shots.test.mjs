// shots.mjs against a temporary HTTP server that serves /frame (the studio doesn't need to be running).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
import { allowedRequest, createShots, frameUrl } from "./shots.mjs";

const PAGE = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<div id="root"><p id="a" style="position:absolute;left:40px;top:60px;margin:0;width:100px;height:20px">Xin chào</p>
<p style="position:absolute;left:40px;top:300px;margin:0">Dòng khác</p></div></body></html>`;

async function server() {
  const urls = [];
  const s = http.createServer((req, res) => { urls.push(req.url); res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(PAGE); });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${s.address().port}`, urls, close: () => new Promise((r) => s.close(r)) };
}
const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

test("frameUrl: version, screen, scenario, theme", () => {
  assert.equal(frameUrl("http://x", { version: "ban-1", entry: "screens/a", scenario: "it-don" }), "http://x/frame?v=ban-1&e=screens%2Fa&s=it-don&th=light");
  assert.equal(frameUrl("http://x", { version: "ban-1", entry: "screens/a", scenario: "-" }), "http://x/frame?v=ban-1&e=screens%2Fa&th=light");
});

test("frame / locate / region share ONE browser; region crops exactly the area + a margin, with the text inside it", async (t) => {
  const srv = await server();
  const shots = createShots({ base: srv.base, idleMs: 60_000 });
  t.after(async () => { await shots.close(); await srv.close(); });
  const f = await shots.frame({ version: "ban-1", entry: "screens/a", viewport: "mobile" });
  assert.deepEqual([...f.png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(pngSize(f.png).w, 390);
  assert.match(srv.urls[0], /^\/frame\?v=ban-1&e=screens%2Fa/);
  const hits = await shots.locate({ version: "ban-1", entry: "screens/a", scenario: "-", viewport: "desktop", text: "xin chào" });
  assert.equal(hits[0].tag, "p");
  assert.deepEqual([hits[0].x, hits[0].y], [40, 60]);
  const r = await shots.region({ version: "ban-1", entry: "screens/a", ref: { scenario: null, viewport: "desktop", rect: { x: 40, y: 60, w: 100, h: 20 } } });
  assert.deepEqual(pngSize(r.png), { w: 164, h: 84 });
  assert.deepEqual(r.texts, ["Xin chào"]);
  assert.equal(shots._launches, 1);
});

test("the screenshot browser (treated as localhost) can only GET resources of the RIGHT version — no write APIs, no other versions, no threads", async (t) => {
  const reached = [];
  const evil = `<!doctype html><html><body><div id="root"><p>x</p></div><script>
    fetch("/__api/versions/ban-1", { method: "DELETE" }).catch(() => {});
    fetch("/__api/threads/t_x/claude", { method: "POST", body: "{}" }).catch(() => {});
    fetch("/versions/ban-2/boards/a.tsx").catch(() => {});
    fetch("/threads/t_x.json").catch(() => {});
    fetch("/data/uploads/x.png").catch(() => {});
    fetch("https://example.com/leak").catch(() => {});
    fetch("/versions/ban-1/boards/ok.tsx").catch(() => {});
    fetch("/__api/spec?v=ban-1&entry=a&kind=tech").catch(() => {});
  </script></body></html>`;
  const s = http.createServer((req, res) => { reached.push(`${req.method} ${req.url}`); res.writeHead(200, { "Content-Type": "text/html" }); res.end(req.url.startsWith("/frame") ? evil : "ok"); });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const shots = createShots({ base: `http://127.0.0.1:${s.address().port}`, idleMs: 60_000 });
  t.after(async () => { await shots.close(); await new Promise((r) => s.close(r)); });
  await shots.frame({ version: "ban-1", entry: "screens/a", viewport: "desktop" });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(reached.includes("GET /versions/ban-1/boards/ok.tsx"), reached.join(" | "));
  assert.ok(reached.some((x) => x.startsWith("GET /__api/spec?")), "reading the spec (the /spec page) still works");
  for (const bad of ["DELETE /__api/versions/ban-1", "POST /__api/threads/t_x/claude", "GET /versions/ban-2/boards/a.tsx", "GET /threads/t_x.json", "GET /data/uploads/x.png"]) {
    assert.ok(!reached.includes(bad), `leaked: ${bad}`);
  }
});

test("allowedRequest: enough for the real page to render (the entry list of the RIGHT version, the project's external origins) without opening anything more", () => {
  const o = { origin: "http://h", version: "ban-1" };
  assert.equal(allowedRequest("http://h/__api/entries?v=ban-1", "GET", o), true);
  assert.equal(allowedRequest("http://h/__api/entries?v=ban-2", "GET", o), false);
  assert.equal(allowedRequest("http://h/__api/entries", "GET", o), false);
  assert.equal(allowedRequest("http://h/__api/project", "GET", o), true, "project name on the spec page");
  assert.equal(allowedRequest("http://h/__api/project", "POST", o), false);
  // Another site only when the project lists it (craft-table.json externalOrigins), e.g. an avatar service.
  const ext = { ...o, externalOrigins: ["https://avatars.example"] };
  assert.equal(allowedRequest("https://avatars.example/a/k1.png", "GET", o), false, "not listed");
  assert.equal(allowedRequest("https://avatars.example/a/k1.png", "GET", ext), true);
  assert.equal(allowedRequest("https://avatars.example/a/x", "POST", ext), false);
  assert.equal(allowedRequest("https://avatars.example.evil/x", "GET", ext), false);
  assert.equal(allowedRequest("https://evil.example/x.png", "GET", o), false);
  assert.equal(allowedRequest("http://h/@fs/srv/project/threads/t.json", "GET", o), false);
  assert.equal(allowedRequest("http://h/@fs/srv/project/node_modules/react/index.js", "GET", o), true);
});

test("allowedRequest: the tool's own files (frame entry) are allowed under its URL prefix — nothing beside it", () => {
  const o = { origin: "http://h", version: "main", tool: "/@fs/srv/craft-table" };
  assert.equal(allowedRequest("http://h/@fs/srv/craft-table/studio/src/frame-entry.tsx", "GET", o), true);
  assert.equal(allowedRequest("http://h/@fs/srv/craft-table/studio/../secrets.env", "GET", o), false);
  assert.equal(allowedRequest("http://h/@fs/srv/craft-table-x/studio/a.ts", "GET", o), false);
  assert.equal(allowedRequest("http://h/studio/src/frame-entry.tsx", "GET", o), false, "no fixed /studio/ path any more");
  assert.equal(allowedRequest("http://h/node_modules/craft-table/studio/src/frame-entry.tsx", "GET", { ...o, tool: "/node_modules/craft-table" }), true);
});

test("two calls at once while the browser is not open yet → only ONE browser; it does not close itself while a page is open", async (t) => {
  const srv = await server();
  const shots = createShots({ base: srv.base, idleMs: 100 });
  t.after(async () => { await shots.close(); await srv.close(); });
  await Promise.all([
    shots.frame({ version: "ban-1", entry: "screens/a", viewport: "desktop" }),
    shots.frame({ version: "ban-1", entry: "screens/b", viewport: "mobile" }),
    shots.locate({ version: "ban-1", entry: "screens/a", scenario: "-", viewport: "desktop", text: "Xin" }),
  ]);
  assert.equal(shots._launches, 1);
});

test("shrink: large image → JPEG with the long edge ≤ 1568, aspect ratio kept; a transparent background turns white (not black)", async (t) => {
  const shots = createShots({ base: "http://127.0.0.1:9", idleMs: 60_000 });
  t.after(() => shots.close());
  const src = transparentPng(3000, 2000);
  const out = await shots.shrink(src);
  assert.deepEqual([out[0], out[1]], [0xff, 0xd8], "is a JPEG");
  assert.deepEqual(jpegSize(out), { w: 1568, h: 1045 });
  const small = await shots.shrink(transparentPng(400, 300));
  assert.deepEqual(jpegSize(small), { w: 400, h: 300 }, "a small image is not scaled up");
  const { default: puppeteer } = await import("puppeteer");
  const b = await puppeteer.launch({ headless: true, timeout: 120_000, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  t.after(() => b.close());
  const p = await b.newPage();
  const px = await p.evaluate(async (src) => {
    const im = new Image(); im.src = src; await im.decode();
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    const g = c.getContext("2d"); g.drawImage(im, 0, 0);
    return [...g.getImageData(10, 10, 1, 1).data.slice(0, 3)];
  }, `data:image/jpeg;base64,${small.toString("base64")}`);
  assert.ok(px.every((v) => v > 240), `the pixel must be white, got ${px}`);
});

/** A fully transparent w×h RGBA PNG (encoded by hand: IHDR + IDAT zlib + IEND). */
function transparentPng(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h); // each row: filter byte 0 + all-zero RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
/** JPEG size: find the SOF0/SOF2 frame. */
function jpegSize(b) {
  for (let i = 2; i < b.length;) {
    const marker = b[i + 1], len = b.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  return null;
}

test("idle longer than idleMs → the browser closes itself; it opens again next time", async (t) => {
  const srv = await server();
  const shots = createShots({ base: srv.base, idleMs: 200 });
  t.after(async () => { await shots.close(); await srv.close(); });
  await shots.frame({ version: "ban-1", entry: "screens/a", viewport: "desktop" });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(shots._open, false);
  await shots.frame({ version: "ban-1", entry: "screens/a", viewport: "desktop" });
  assert.equal(shots._launches, 2);
});

// Chrome sometimes dies as it starts on a busy machine ("Failed to launch the browser process … signal 11"): the
// screenshot taker starts it again, up to 3 tries, instead of failing Claude's turn.
const fakeChrome = () => ({ on() {}, close: async () => {}, newPage: async () => ({ evaluate: async () => Buffer.from("ok").toString("base64"), close: async () => {} }) });
const crash = () => new Error("Failed to launch the browser process!\nReceived signal 11");

test("Chrome that crashes as it starts is started again (up to 3 tries)", async () => {
  let calls = 0;
  const shots = createShots({ base: "http://127.0.0.1:9", retryDelayMs: 0, launch: async () => { if (++calls < 3) throw crash(); return fakeChrome(); } });
  assert.equal(String(await shots.shrink(Buffer.from("png"))), "ok");
  assert.equal(calls, 3);
  assert.equal(shots._launches, 1);
  await shots.close();
});

test("Chrome that never starts: the third failure is the error", async () => {
  let calls = 0;
  const shots = createShots({ base: "http://127.0.0.1:9", retryDelayMs: 0, launch: async () => { calls++; throw crash(); } });
  await assert.rejects(shots.shrink(Buffer.from("png")), /Failed to launch/);
  assert.equal(calls, 3);
});

test("inspect: a picture, the height, the problems the page reported, and the result of a check run inside the page", async (t) => {
  const urls = [];
  const html = `<!doctype html><html><body style="margin:0"><div id="root"><button>a</button><button>b</button><p style="height:900px">tall</p></div><script>console.error("boom from the board")</script></body></html>`;
  const s = http.createServer((req, res) => { urls.push(req.url); if (req.url.startsWith("/missing")) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const shots = createShots({ base: `http://127.0.0.1:${s.address().port}`, idleMs: 60_000 });
  t.after(async () => { await shots.close(); await new Promise((r) => s.close(r)); });
  const r = await shots.inspect({ version: "ban-1", entry: "screens/a", scenario: "x", theme: "dark", evalJs: "document.querySelectorAll('button').length" });
  assert.deepEqual([...r.png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.ok(r.height >= 900);
  assert.equal(r.value, 2);
  assert.equal(r.boardError, false);
  assert.ok(r.errors.some((e) => /console: boom from the board/.test(e)), JSON.stringify(r.errors));
  assert.match(urls[0], /th=dark/);
  const bad = await shots.inspect({ version: "ban-1", entry: "screens/a", evalJs: "this is not js", shot: false });
  assert.equal(bad.png, null);
  assert.match(bad.evalError, /./);
  const obj = await shots.inspect({ version: "ban-1", entry: "screens/a", evalJs: "({ w: innerWidth, n: [1,2] })", shot: false });
  assert.deepEqual(obj.value, { w: 1280, n: [1, 2] });
});

test("a desktop frame is shot at the project's desktop size (what the person sees is what Claude sees)", async (t) => {
  const srv = await server();
  let size = { w: 1000, h: 600 };
  const shots = createShots({ base: srv.base, idleMs: 60_000, desktop: () => size });
  t.after(async () => { await shots.close(); await srv.close(); });
  const a = await shots.frame({ version: "ban-1", entry: "screens/a", viewport: "desktop" });
  assert.deepEqual(pngSize(a.png), { w: 1000, h: 600 });
  size = { w: 1200, h: 700 };
  const b = await shots.inspect({ version: "ban-1", entry: "screens/a", viewport: "desktop", evalJs: "[innerWidth, innerHeight]" });
  assert.deepEqual(pngSize(b.png), { w: 1200, h: 700 });
  assert.deepEqual(b.value, [1200, 700]);
  const m = await shots.frame({ version: "ban-1", entry: "screens/a", viewport: "mobile" });
  assert.equal(pngSize(m.png).w, 390, "mobile is unchanged");
});

// A frame page like frame-entry.tsx: draws its ?s= scenario a moment after loading, and redraws on __craftShow(s).
// Scenario "tall" is 1500 px tall, "err" reports a console error and throws.
const SWITCH_PAGE = (hook) => `<!doctype html><html><body style="margin:0"><div id="root"></div><script>
const draw = (s) => { const r = document.getElementById("root"); r.innerHTML = "";
  if (s === "err") { console.error("boom in " + s); setTimeout(() => { throw new Error("thrown in " + s); }); }
  const p = document.createElement("p"); p.style.cssText = "margin:0;height:" + (s === "tall" ? 1500 : 100) + "px"; p.textContent = s; r.appendChild(p); };
setTimeout(() => draw(new URLSearchParams(location.search).get("s") ?? "-"), 300);
${hook ? 'window.__craftShow = (s) => draw(s ?? "-");' : ""}
</script></body></html>`;

async function switchServer(hook) {
  const urls = [];
  const s = http.createServer((req, res) => { urls.push(req.url); res.writeHead(200, { "Content-Type": "text/html" }); res.end(SWITCH_PAGE(hook)); });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${s.address().port}`, urls, close: () => new Promise((r) => s.close(r)) };
}

test("inspectScenarios: every scenario of a screen in ONE page load — results in order, each with its own problems", async (t) => {
  const srv = await switchServer(true);
  const shots = createShots({ base: srv.base, idleMs: 60_000 });
  t.after(async () => { await shots.close(); await srv.close(); });
  const rs = await shots.inspectScenarios({ version: "ban-1", entry: "screens/a", scenarios: ["one", "tall", "err", "two"], evalJs: "document.querySelector('p').textContent" });
  assert.deepEqual(rs.map((r) => r.value), ["one", "tall", "err", "two"]);
  assert.ok(rs[1].height >= 1500 && rs[0].height < 1500 && rs[3].height < 1500, JSON.stringify(rs.map((r) => r.height)));
  assert.ok(rs[2].errors.some((e) => /console: boom in err/.test(e)) && rs[2].errors.some((e) => /thrown in err/.test(e)), JSON.stringify(rs[2].errors));
  assert.deepEqual([rs[0].errors, rs[1].errors, rs[3].errors], [[], [], []], "a scenario's problems stay with it");
  assert.ok(rs.every((r) => r.png === null));
  assert.equal(srv.urls.filter((u) => u.startsWith("/frame")).length, 1, JSON.stringify(srv.urls));
});

test("inspectScenarios: a page that cannot switch scenarios → one page load per scenario, same results", async (t) => {
  const srv = await switchServer(false);
  const shots = createShots({ base: srv.base, idleMs: 60_000 });
  t.after(async () => { await shots.close(); await srv.close(); });
  const rs = await shots.inspectScenarios({ version: "ban-1", entry: "screens/a", scenarios: ["one", "tall", "-"], evalJs: "document.querySelector('p').textContent" });
  assert.deepEqual(rs.map((r) => r.value), ["one", "tall", "-"]);
  assert.equal(srv.urls.filter((u) => u.startsWith("/frame")).length, 3);
});

test("several pages at once finish together: waiting for the board does not hang on animation frames (only the tab in front gets them)", async (t) => {
  const srv = await switchServer(true);
  const shots = createShots({ base: srv.base, idleMs: 60_000 });
  t.after(async () => { await shots.close(); await srv.close(); });
  const t0 = Date.now();
  const names = Array.from({ length: 16 }, (_, i) => `s${i}`);
  const done = await Promise.all(names.map(async (s) => {
    const r = await shots.inspect({ version: "ban-1", entry: "screens/a", scenario: s, shot: false, evalJs: "document.querySelector('p')?.textContent" });
    assert.equal(r.value, s);
    return Date.now() - t0;
  }));
  // Polling on animation frames served the pages one after another: 16 pages ended 2.6 s apart (measured); by time, ~0.1 s.
  const spread = Math.max(...done) - Math.min(...done);
  assert.ok(spread < 1200, `16 pages ended ${spread} ms apart`);
});
