import { test } from "node:test";
import assert from "node:assert/strict";
import { boardError } from "./vite-error.mjs";

const FILE = "/versions/thu/boards/screens/orders/list.tsx";
const ABS = `/srv/project${FILE}`;

test("babel error (path: message (line:column) + code frame) → line, column, short message", () => {
  const err = { message: `${ABS}: Unexpected token (261:78)\n\n  259 |   <button>\n> 261 |  Tất cả <<<\n      |  ^`, id: ABS };
  assert.deepEqual(boardError(err, FILE), { line: 261, column: 78, message: "Unexpected token" });
});

test("esbuild error (Transform failed…, loc) → taken from loc, path + ERROR: stripped", () => {
  const err = { message: `Transform failed with 1 error:\n${ABS}:12:5: ERROR: Expected ">" but found "<"`, loc: { file: ABS, line: 12, column: 5 } };
  assert.deepEqual(boardError(err, FILE), { line: 12, column: 5, message: 'Expected ">" but found "<"' });
});

test("an error from another file (another board, another version) → null", () => {
  assert.equal(boardError({ message: "/srv/x/versions/thu/boards/screens/orders/today.tsx: Unexpected token (1:1)", id: "/srv/x/versions/thu/boards/screens/orders/today.tsx" }, FILE), null);
  assert.equal(boardError({ message: "x", id: `/srv/x/versions/khac/boards/screens/orders/list.tsx` }, FILE), null);
  assert.equal(boardError(undefined, FILE), null);
});

test("no id/loc → matched by the path at the start of the message; unknown line → line null", () => {
  assert.deepEqual(boardError({ message: `${ABS}: Something odd` }, FILE), { line: null, column: null, message: "Something odd" });
});
