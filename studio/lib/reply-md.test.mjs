import { test } from "node:test";
import assert from "node:assert/strict";
import { replyBlocks, replyPlain } from "./reply-md.mjs";

const T = (v) => ({ t: "text", v });

test("replyBlocks: bold, italic, strikethrough, code, line breaks within a paragraph", () => {
  assert.deepEqual(replyBlocks("**Đã sửa:** _nút_ ~~cũ~~ `a.tsx`\ndòng hai"), [
    { t: "p", c: [{ t: "b", c: [T("Đã sửa:")] }, T(" "), { t: "i", c: [T("nút")] }, T(" "), { t: "del", c: [T("cũ")] }, T(" "), { t: "code", v: "a.tsx" }, { t: "br" }, T("dòng hai")] },
  ]);
});

test("replyBlocks: lists (nested, numbered), headings, quotes, code blocks, tables", () => {
  const b = replyBlocks("### Kiểm tra\n- typecheck sạch\n  - lint sạch\n1. một\n2. hai\n\n> lưu ý\n\n```\nx < 1\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |");
  assert.deepEqual(b[0], { t: "h", c: [T("Kiểm tra")] });
  assert.deepEqual(b[1], { t: "ul", items: [[{ t: "p", c: [T("typecheck sạch")] }, { t: "ul", items: [[{ t: "p", c: [T("lint sạch")] }]] }]] });
  assert.deepEqual(b[2], { t: "ol", start: 1, items: [[{ t: "p", c: [T("một")] }], [{ t: "p", c: [T("hai")] }]] });
  assert.deepEqual(b[3], { t: "quote", c: [{ t: "p", c: [T("lưu ý")] }] });
  assert.deepEqual(b[4], { t: "pre", v: "x < 1" });
  assert.deepEqual(b[5], { t: "table", head: [[T("A")], [T("B")]], rows: [[[T("1")], [T("2")]]] });
});

test("replyBlocks: [#n] becomes a mark reference — in a paragraph, in a list, in bold, two references back to back", () => {
  assert.deepEqual(replyBlocks("Xem [#1] và **[#2]**"), [{ t: "p", c: [T("Xem "), { t: "ref", k: 1 }, T(" và "), { t: "b", c: [{ t: "ref", k: 2 }] }] }]);
  assert.deepEqual(replyBlocks("- nút [#3]"), [{ t: "ul", items: [[{ t: "p", c: [T("nút "), { t: "ref", k: 3 }] }]] }]);
  assert.deepEqual(replyBlocks("[#1][#2]"), [{ t: "p", c: [{ t: "ref", k: 1 }, { t: "ref", k: 2 }] }]);
});

test("replyBlocks is SAFE: HTML shows as text, javascript: links / external images don't become links/images; the characters & < > stay intact", () => {
  const flat = JSON.stringify(replyBlocks("<script>alert(1)</script>\n\nchữ <b>x</b> [bấm](javascript:alert(1)) ![ảnh](https://evil.example.invalid/a.png) [web](https://example.com)\n\na & b < c 'q'"));
  assert.ok(!/"t":"(html|img)"/.test(flat), flat);
  assert.match(flat, /<script>alert\(1\)<\/script>/, "script shows as text");
  assert.ok(!flat.includes("javascript:"), "no javascript: href");
  assert.match(flat, /"t":"a","href":"https:\/\/example.com"/);
  assert.ok(!flat.includes("evil.example.invalid/a.png\",\"t\":\"img"));
  assert.match(flat, /a & b < c 'q'/);
});

test("replyPlain: plain text for the preview line (markdown symbols removed, [#n] references kept)", () => {
  assert.equal(replyPlain("**Đã sửa:** `a.tsx` [#1]\n- typecheck sạch\n- lint sạch"), "Đã sửa: a.tsx [#1] typecheck sạch lint sạch");
});
