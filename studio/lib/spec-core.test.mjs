import { test } from "node:test";
import assert from "node:assert/strict";
import { safeSrcPath, codeRef, specName, SPEC_KINDS } from "./spec-core.mjs";

// The project's source repo: which folders and file types people and Claude may open (craft-table.json "source").
const SCOPE = { roots: ["src", "lib", "tests/api", "docs"], extensions: ["ts", "tsx", "mjs", "js", "sql", "md"] };

test("safeSrcPath: files inside the configured folders with an allowed extension", () => {
  assert.equal(safeSrcPath("src/server/api/orders.ts", SCOPE), "src/server/api/orders.ts");
  assert.equal(safeSrcPath("src/client/pages/Orders.tsx", SCOPE), "src/client/pages/Orders.tsx");
  assert.equal(safeSrcPath("lib/0001_init.sql", SCOPE), "lib/0001_init.sql");
  assert.equal(safeSrcPath("tests/api/orders.test.ts", SCOPE), "tests/api/orders.test.ts");
  assert.equal(safeSrcPath("docs/roles.md", SCOPE), "docs/roles.md");
  assert.equal(safeSrcPath("app/main.py", { roots: ["app"], extensions: ["py"] }), "app/main.py", "any folders / types the project chooses");
});

test("safeSrcPath: blocks going up, absolute paths, hidden files, other folders, other types — and everything when there is no source", () => {
  for (const bad of [
    "../secrets/app.env", "src/../../secrets/x.ts", "/etc/passwd", "src/.env", "src/x/.hidden.ts",
    "scripts/deploy.sh", "config/live.env", "tests/e2e/auth.mjs", "src/x.env", "src/x.pem", "", "src", "src/",
    "src\\server\\x.ts", "src/server/api/orders.ts\u0000.png", "srcx/a.ts",
  ]) assert.equal(safeSrcPath(bad, SCOPE), null, bad);
  assert.equal(safeSrcPath("src/a.ts", null), null, "no source configured");
  assert.equal(safeSrcPath("src/a.ts"), null);
});

test("codeRef: `path:line` or `:from-to` → link; short names / non-code → null", () => {
  assert.deepEqual(codeRef("src/server/api/orders.ts:99", SCOPE), { path: "src/server/api/orders.ts", from: 99, to: 99 });
  assert.deepEqual(codeRef("src/client/pages/Orders.tsx:480-505", SCOPE), { path: "src/client/pages/Orders.tsx", from: 480, to: 505 });
  assert.deepEqual(codeRef("src/lib/money.ts", SCOPE), { path: "src/lib/money.ts", from: null, to: null });
  assert.equal(codeRef("O:120", SCOPE), null);
  assert.equal(codeRef("orders.ts:99", SCOPE), null);
  assert.equal(codeRef("orders:lockTime", SCOPE), null);
  assert.equal(codeRef("../secrets/x.ts:1", SCOPE), null);
  assert.equal(codeRef("src/lib/money.ts:1", null), null, "no source → no links");
});

test("specName: the two tabs Behavior / Tech → a file next to the drawing; an odd kind → null", () => {
  assert.deepEqual(SPEC_KINDS, ["behavior", "tech"]);
  assert.equal(specName("screens/orders/list", "behavior"), "screens/orders/list.behavior.md");
  assert.equal(specName("screens/orders/list", "tech"), "screens/orders/list.tech.md");
  assert.equal(specName("screens/orders/list", "x"), null);
  assert.equal(specName("../x", "tech"), null);
});

import { shortRef } from "./spec-core.mjs";
test("shortRef: file name + lines; a generic file name gets its parent folder too", () => {
  assert.equal(shortRef({ path: "src/client/pages/Checkout.tsx", from: 14, to: 88 }), "Checkout.tsx:14–88");
  assert.equal(shortRef({ path: "src/server/api/orders.ts", from: 99, to: 99 }), "orders.ts:99");
  assert.equal(shortRef({ path: "src/server/api/index.ts", from: 51, to: 51 }), "api/index.ts:51");
  assert.equal(shortRef({ path: "src/client/pages/order-detail/types.ts", from: null, to: null }), "order-detail/types.ts");
});

import { parseSrcFence, sliceLines } from "./spec-core.mjs";
test("parseSrcFence: ```src``` block → path + lines + caption; outside the allowed area → null", () => {
  assert.deepEqual(parseSrcFence("src/server/api/orders.ts:443-470 Save the whole order", SCOPE), { path: "src/server/api/orders.ts", from: 443, to: 470, caption: "Save the whole order" });
  assert.deepEqual(parseSrcFence("  src/lib/money.ts:55  ", SCOPE), { path: "src/lib/money.ts", from: 55, to: 55, caption: "" });
  assert.equal(parseSrcFence("src/lib/money.ts", SCOPE), null, "needs lines");
  assert.equal(parseSrcFence("../secrets/x.ts:1-2", SCOPE), null);
  assert.equal(parseSrcFence("src/lib/money.ts:55", null), null);
});

test("sliceLines: the excerpt + context margin, clamped to the file, with a line cap", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `l${i + 1}`);
  assert.deepEqual(sliceLines(lines, 10, 12, 2, 80), { start: 8, lines: ["l8", "l9", "l10", "l11", "l12", "l13", "l14"], from: 10, to: 12, total: 100, cut: false });
  const head = sliceLines(lines, 1, 2, 3, 80);
  assert.equal(head.start, 1);
  assert.deepEqual(head.lines, ["l1", "l2", "l3", "l4", "l5"]);
  const big = sliceLines(lines, 5, 95, 0, 20);
  assert.equal(big.lines.length, 20);
  assert.equal(big.cut, true);
});

import { specPages, specPageIndex, ruleTarget, slugVi } from "./spec-core.mjs";
const DOC = `# Đơn hàng — Hành vi

> Nhân viên duyệt từng đơn.

## Ai dùng, khi nào
- Nhân viên bán hàng.

## Luật
Mỗi luật có số riêng.

### Ai được làm gì
- **R1.** Chỉ nhân viên bán hàng.
- **R2.** Đơn đã giao thì không sửa được.

### Duyệt và lưu
**R3.** Tự lưu sau 0,7 giây (xem **R1**).

\`\`\`mermaid
flowchart TD
  A --> B
\`\`\`

## Dữ liệu
### Bảng
\`\`\`bash
# không phải tiêu đề
\`\`\`
## Câu hỏi cần chốt
- Có khoá ngày không?
`;

test("slugVi: strips diacritics, đ→d, hyphens", () => {
  assert.equal(slugVi("Ai dùng, khi nào"), "ai-dung-khi-nao");
  assert.equal(slugVi("Đường đi & Quyền"), "duong-di-quyen");
  assert.equal(slugVi("Trạng thái URL & cache"), "trang-thai-url-cache");
});

test("specPages: one page per ##; a ## with ### gets one page per ### (the ## intro becomes its own page if it has text)", () => {
  const p = specPages(DOC, { lang: "vi" });
  assert.deepEqual(p.map((x) => [x.id, x.title, x.group, x.depth]), [
    ["overview", "Tổng quan", null, 0],
    ["ai-dung-khi-nao", "Ai dùng, khi nào", null, 0],
    ["luat", "Luật", "Luật", 0],
    ["luat/ai-duoc-lam-gi", "Ai được làm gì", "Luật", 1],
    ["luat/duyet-va-luu", "Duyệt và lưu", "Luật", 1],
    ["du-lieu/bang", "Bảng", "Dữ liệu", 1],
    ["cau-hoi-can-chot", "Câu hỏi cần chốt", null, 0],
  ]);
  // h1 is dropped (the frame already shows the title); the page's heading line is dropped too (the frame draws the heading)
  assert.equal(p[0].markdown.trim(), "> Nhân viên duyệt từng đơn.");
  assert.equal(p[2].markdown.trim(), "Mỗi luật có số riêng.");
  assert.doesNotMatch(p[3].markdown, /###/);
  // "# không phải tiêu đề" sits in a code block → no page split, it stays in the Bảng page
  assert.match(p[5].markdown, /# không phải tiêu đề/);
  assert.match(p[4].markdown, /```mermaid/);
  // rules DEFINED on the page (start of a line / start of a list item); mentions do not count
  assert.deepEqual(p[3].rules, ["R1", "R2"]);
  assert.deepEqual(p[4].rules, ["R3"]);
});

test("specPages: the intro page's title follows the language given (the viewer's); English by default; the id never changes", () => {
  const md = "# T\n\nIntro.\n\n## A\na";
  assert.deepEqual(specPages(md).map((x) => [x.id, x.title]), [["overview", "Overview"], ["a", "A"]]);
  assert.equal(specPages(md, { lang: "en" })[0].title, "Overview");
  assert.equal(specPages(md, { lang: "xx" })[0].title, "Overview");
  assert.deepEqual(specPages(md, { lang: "vi" }).map((x) => [x.id, x.title]), [["overview", "Tổng quan"], ["a", "A"]]);
});

test("specPages: a document with no ## → one page", () => {
  assert.deepEqual(specPages("# T\n\nChỉ có đoạn này.").map((x) => x.id), ["overview"]);
  assert.deepEqual(specPages(""), []);
});

test("specPages: duplicate section names → the id gets a number; a heading with no letters gets the neutral default slug", () => {
  const p = specPages("## Giao diện\na\n## Giao diện\nb");
  assert.deepEqual(p.map((x) => x.id), ["giao-dien", "giao-dien-2"]);
  assert.deepEqual(specPages("## ???\na\n## !!!\nb\n### ...\nc").map((x) => x.id), ["section", "section-2", "section-2/section"]);
});

test("specPageIndex: the page of an id; ids written with the old default slugs (tong-quan, muc) still open their page", () => {
  const p = specPages(DOC);
  assert.equal(specPageIndex(p, "luat/duyet-va-luu"), 4);
  assert.equal(specPageIndex(p, "overview"), 0);
  assert.equal(specPageIndex(p, "tong-quan"), 0, "an old bookmark of the overview page");
  assert.equal(specPageIndex(specPages("## ???\na\n## B\nb"), "muc"), 0);
  assert.equal(specPageIndex(p, "khong-co"), -1);
  assert.equal(specPageIndex(p, null), -1);
});

test("ruleTarget: the page that DEFINES the rule; failing that, the first page that mentions it; failing that → null", () => {
  const p = specPages(DOC);
  assert.equal(ruleTarget(p, "R1"), "luat/ai-duoc-lam-gi");
  assert.equal(ruleTarget(p, "R3"), "luat/duyet-va-luu");
  assert.equal(ruleTarget(specPages("## A\nxem **R7** ở dưới\n## B\nkhác"), "R7"), "a");
  assert.equal(ruleTarget(p, "R99"), null);
});
