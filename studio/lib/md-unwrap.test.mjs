import { test } from "node:test";
import assert from "node:assert/strict";
import { unwrapMarkdown } from "./md-unwrap.mjs";

test("paragraphs, list items (numbered too) and quotes broken mid-sentence → joined back into one line", () => {
  assert.equal(unwrapMarkdown("a b\nc d\n\ne"), "a b c d\n\ne");
  assert.equal(unwrapMarkdown("- **Ai**: người bán hàng. Dùng sau khi đăng nhập bằng tài khoản\n  của cửa hàng, trên máy tính hoặc điện thoại.\n- **Khi nào**: sau đăng nhập"),
    "- **Ai**: người bán hàng. Dùng sau khi đăng nhập bằng tài khoản của cửa hàng, trên máy tính hoặc điện thoại.\n- **Khi nào**: sau đăng nhập");
  assert.equal(unwrapMarkdown("4. Trong thẻ: băng vàng,\n   Chờ giao.\n5. Người bán bấm"), "4. Trong thẻ: băng vàng, Chờ giao.\n5. Người bán bấm");
  assert.equal(unwrapMarkdown("> Trang đầu tiên nhân viên thấy\n> được bao nhiêu đơn.\n\nx"), "> Trang đầu tiên nhân viên thấy được bao nhiêu đơn.\n\nx");
  assert.equal(unwrapMarkdown("**R1.** Chỉ người có vai\nnhân viên kho.\n"), "**R1.** Chỉ người có vai nhân viên kho.\n");
  assert.equal(unwrapMarkdown("- a\n\n  đoạn hai\n  tiếp"), "- a\n\n  đoạn hai tiếp");
});

test("kept as is: headings, nested lists, new items, code/diagram blocks, tables, rules, intentional line breaks", () => {
  assert.equal(unwrapMarkdown("## Ai dùng\nb\nc"), "## Ai dùng\nb c");
  for (const keep of [
    "- a\n  - b\n  - c",
    "1. a\n2. b",
    "```mermaid\nflowchart TD\n  A --> B\n  B --> C\n```",
    "```src src/a.ts:1-3\nx\ny\n```",
    "| a | b |\n|---|---|\n| 1 | 2 |",
    "đoạn\n\n---\n\nđoạn",
    "a  \nb",
    "a\\\nb",
    "Tiêu đề\n---",
    "<details>\n<summary>x</summary>\n</details>",
    "> a\n>\n> b",
    "> - a\n> - b",
  ]) assert.equal(unwrapMarkdown(keep), keep, keep);
});
