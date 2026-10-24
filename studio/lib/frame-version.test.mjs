// A frame's version (frame-entry.tsx): ?v= or the live version according to the server; if the server can't be asked → a clear error, no guessing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { frameVersion } from "./frame-version.mjs";

/** Fake fetch: records the URLs asked; returns `res`, or throws if `res` is an Error. */
function fakeFetch(res) {
  const asked = [];
  const f = async (url) => { asked.push(url); if (res instanceof Error) throw res; return res; };
  return Object.assign(f, { asked });
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("frameVersion: with ?v= → used as is, the server is not asked", async () => {
  const f = fakeFetch(new Error("must not be called"));
  assert.deepEqual(await frameVersion("v3", f), { version: "v3" });
  assert.deepEqual(f.asked, []);
});

test("frameVersion: without ?v= → the live version from /__api/versions", async () => {
  const f = fakeFetch(json(200, { versions: [], live: "v2" }));
  assert.deepEqual(await frameVersion(null, f), { version: "v2" });
  assert.deepEqual(f.asked, ["/__api/versions"]);
  assert.deepEqual(await frameVersion("", fakeFetch(json(200, { live: "goc" }))), { version: "goc" });
});

test("frameVersion: the server can't be asked → an error that states the reason, does NOT guess a version", async () => {
  const cases = [
    [new TypeError("Failed to fetch"), /không hỏi được máy chủ xưởng \(Failed to fetch\)/],
    [json(400, { error: "ENOENT: no such file or directory, open '/p/versions/index.json'" }), /máy chủ xưởng trả lỗi 400: ENOENT.*versions\/index\.json/],
    [new Response("Xưởng chưa cấu hình đăng nhập.", { status: 503 }), /máy chủ xưởng trả lỗi 503: Xưởng chưa cấu hình đăng nhập\./],
    [json(200, { versions: [] }), /versions\/index\.json chưa ghi "live"/],
    [json(200, { live: "../x" }), /versions\/index\.json chưa ghi "live"/],
    [new Response("<html>", { status: 200 }), /máy chủ xưởng trả dữ liệu không đọc được/],
  ];
  for (const [res, why] of cases) {
    const r = await frameVersion(null, fakeFetch(res), { lang: "vi" });
    assert.equal(r.version, undefined, String(why));
    assert.match(r.error, /^Không mở được khung: chưa biết phiên bản nào đang chạy — /, String(why));
    assert.match(r.error, why);
    assert.match(r.error, /\?v=/, "says how to open a specific version");
  }
});

test("frameVersion: the error follows the language given (the viewer's); vi word for word as before; English by default", async () => {
  const HINT_VI = "Mở khung kèm ?v=<phiên-bản> để xem một bản cụ thể.";
  const vi = async (res) => (await frameVersion(null, fakeFetch(res), { lang: "vi" })).error;
  assert.equal(await vi(new TypeError("Failed to fetch")), `Không mở được khung: chưa biết phiên bản nào đang chạy — không hỏi được máy chủ xưởng (Failed to fetch). ${HINT_VI}`);
  assert.equal(await vi(new Response("Xưởng chưa cấu hình đăng nhập.", { status: 503 })), `Không mở được khung: chưa biết phiên bản nào đang chạy — máy chủ xưởng trả lỗi 503: Xưởng chưa cấu hình đăng nhập. ${HINT_VI}`);
  assert.equal(await vi(new Response("", { status: 500 })), `Không mở được khung: chưa biết phiên bản nào đang chạy — máy chủ xưởng trả lỗi 500. ${HINT_VI}`);
  assert.equal(await vi(new Response("<html>", { status: 200 })), `Không mở được khung: chưa biết phiên bản nào đang chạy — máy chủ xưởng trả dữ liệu không đọc được. ${HINT_VI}`);
  assert.equal(await vi(json(200, { versions: [] })), `Không mở được khung: chưa biết phiên bản nào đang chạy — versions/index.json chưa ghi "live" hợp lệ. ${HINT_VI}`);
  const HINT_EN = "Open the frame with ?v=<version> to see a specific version.";
  const en = async (res, opts) => (await frameVersion(null, fakeFetch(res), opts)).error;
  assert.equal(await en(new TypeError("Failed to fetch")), `Can't open the frame: no live version is known — the studio server could not be reached (Failed to fetch). ${HINT_EN}`);
  assert.equal(await en(json(400, { error: "Bad thing." }), { lang: "en" }), `Can't open the frame: no live version is known — the studio server returned error 400: Bad thing. ${HINT_EN}`);
  assert.equal(await en(new Response("", { status: 500 }), { lang: "xx" }), `Can't open the frame: no live version is known — the studio server returned error 500. ${HINT_EN}`);
  assert.equal(await en(new Response("<html>", { status: 200 })), `Can't open the frame: no live version is known — the studio server sent data it could not read. ${HINT_EN}`);
  assert.equal(await en(json(200, { live: "../x" })), `Can't open the frame: no live version is known — versions/index.json has no valid "live". ${HINT_EN}`);
});
