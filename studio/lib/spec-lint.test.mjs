// The plain-language RULE: DESCRIPTIONS (board title + description, scenario descriptions, the
// Behavior tab) are plain words for people to read — everything technical (code, paths, file:line, variable names,
// tables/columns, APIs, error codes, English jargon) goes in the Technical tab. A project applies the rule to its own
// boards with its own test (craft-table.json → lint.plainLanguage).
// Two vocabularies: the project's language picks one ({ lang }); without a language the Vietnamese one
// applies, as before the studio spoke two languages (a project's own tests call it that way).
import { test } from "node:test";
import assert from "node:assert/strict";
import { humanIssues, behaviorIssues } from "./spec-lint.mjs";
import { VIETNAMESE } from "./i18n-gate.mjs";

test("humanIssues (vi, the default): plain words → no issue", () => {
  assert.deepEqual(humanIssues("Người bán bấm “Duyệt” rồi chọn Huỷ; hộp ghi lý do tự mở. Lưu tự động sau khoảng nửa giây."), []);
  assert.deepEqual(humanIssues("**R5.** Nhân viên chỉ thấy các kho mình đang quản lý. (xem Kỹ thuật: R5 hoặc lỗi #4)"), []);
  assert.deepEqual(humanIssues("Băng vàng “Còn 3 đơn chưa giao”; 3 ô Đã giao / Đang giao / Đã huỷ."), []);
});

const VI_CASES = {
  "API lỗi → `if (!data) return null` (L:22)": ["`", "L:22", "API"],
  "app vẫn quay mãi (isPending || !data, O:120)": ["isPending", "||", "O:120"],
  "canEdit=false: ẩn tab": ["canEdit"],
  "Dựng lại màn /orders/list (đối chiếu refs/orders/list-*.png)": ["/orders/list", "refs/orders/list-*.png"],
  "khoá theo placed_at trong order_line": ["placed_at", "order_line"],
  "vòng chọn SVG mở, banner amber, server trả 409": ["SVG", "banner", "amber", "409"],
  "xem src/lib/money.ts:55": ["src/lib/money.ts:55"],
  "máy chủ trả về 500 khi hết hạn": ["500"],
};

test("humanIssues (vi, the default): catches code, paths, file:line, variable names, tables/columns, APIs, jargon", () => {
  for (const [text, must] of Object.entries(VI_CASES)) {
    const got = humanIssues(text).join(" | ");
    for (const m of must) assert.ok(got.includes(m), `"${text}" must catch "${m}" — caught: ${got}`);
  }
});

test("humanIssues: { lang: 'vi' } is the same vocabulary as no language", () => {
  for (const text of [...Object.keys(VI_CASES), "Người bán bấm “Duyệt” rồi chọn Huỷ."]) assert.deepEqual(humanIssues(text, { lang: "vi" }), humanIssues(text), text);
});

test("humanIssues (en): plain English → no issue, including everyday words the Vietnamese list treats as jargon", () => {
  for (const text of [
    "The seller taps “Approve” and picks Cancel; a box for the reason opens by itself. It saves after about half a second.",
    "**R5.** A seller sees only the shops they run. (see Technical: R5 or error #4)",
    "When there are no orders yet, the list shows an empty state with a short hint.",
    "Search keeps your query when you go back, and a banner says the order shipped.",
    "Yes/No buttons; the badge turns amber after 3 days; the session ends after 30 minutes.",
  ]) assert.deepEqual(humanIssues(text, { lang: "en" }), [], text);
});

test("humanIssues (en): catches code, paths, file:line, names in code form, developer jargon, HTTP codes", () => {
  const cases = {
    "When the API endpoint fails → `if (!data) return null` (L:22)": ["`", "L:22", "API", "endpoint"],
    "spins forever (isPending || !data, O:120)": ["isPending", "||", "O:120"],
    "canEdit=false: hide the tab": ["canEdit"],
    "Rebuild /orders/list (compare refs/orders/list-*.png)": ["/orders/list", "refs/orders/list-*.png"],
    "keyed by placed_at in order_line": ["placed_at", "order_line"],
    "stores the JSON payload in the database": ["JSON", "payload", "database"],
    "the server returns 409 when the slot is taken": ["409"],
    "shows error code 500": ["500"],
    "renders <OrderList /> with props from the store": ["<OrderList", "props"],
    "the value is null or undefined, a boolean": ["null", "undefined", "boolean"],
    "see src/lib/money.ts:55": ["src/lib/money.ts:55"],
  };
  for (const [text, must] of Object.entries(cases)) {
    const got = humanIssues(text, { lang: "en" }).join(" | ");
    for (const m of must) assert.ok(got.includes(m), `"${text}" must catch "${m}" — caught: ${got}`);
  }
});

test("behaviorIssues (vi, the default): a mermaid diagram is allowed, but the WORDS in it must be plain", () => {
  const ok = "Người bán duyệt xong là lưu.\n```mermaid\nflowchart TD\n  A[Người bán duyệt một đơn] --> B{Có phải Huỷ?}\n  B -- Có --> C(Hộp lý do tự mở)\n  B -- Không --> D[Lưu sau nửa giây]\n```\n";
  assert.deepEqual(behaviorIssues(ok), []);
  const bad = "```mermaid\nflowchart TD\n  A[isPending] --> B[PUT /api/orders/status]\n```\n";
  const got = behaviorIssues(bad).join(" | ");
  assert.match(got, /isPending/);
  assert.match(got, /\/api\/orders\/status/);
  // outside a diagram: every line is checked as before
  assert.match(behaviorIssues("dòng có `code`").join(" "), /`/);
});

test("behaviorIssues: a code block is reported in the language asked for (uiLang, default = lang)", () => {
  const md = "Intro\n```js\nconst x = 1;\n```\n";
  assert.deepEqual(behaviorIssues(md), ["2: khối code (tab Hành vi không chứa code)"]);
  const en = behaviorIssues(md, { lang: "en" });
  assert.deepEqual(en, ["2: code block (the Behavior tab holds no code)"]);
  assert.doesNotMatch(en.join(" "), VIETNAMESE);
  // The vocabulary follows the content's language; the message the language of whoever reads it.
  assert.deepEqual(behaviorIssues(md, { lang: "en", uiLang: "vi" }), ["2: khối code (tab Hành vi không chứa code)"]);
});

test("behaviorIssues (en): diagram labels are checked with the English vocabulary", () => {
  const ok = "The seller saves.\n```mermaid\nflowchart TD\n  A[The seller approves an order] --> B{Cancelled?}\n  B -- Yes --> C(A banner asks for the reason)\n```\n";
  assert.deepEqual(behaviorIssues(ok, { lang: "en" }), []);
  const got = behaviorIssues("```mermaid\nflowchart TD\n  A[isPending] --> B[the API returns 404]\n```\n", { lang: "en" }).join(" | ");
  assert.match(got, /isPending/);
  assert.match(got, /API/);
  assert.match(got, /404/);
});
