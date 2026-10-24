import { test } from "node:test";
import assert from "node:assert/strict";
import { cssDangers } from "./css-guard.mjs";

test("regular design-system CSS → nothing dangerous", () => {
  assert.deepEqual(cssDangers(`@import "tailwindcss";\n@import "./fonts.css";\n@theme static { --x: 1; }\n@font-face { src: url(/a.woff2); }\n@media print { a { b: c } }`), []);
});

test("@plugin / @config (Tailwind loads and RUNS JS/TS files), @source, unknown @import → caught", () => {
  assert.equal(cssDangers(`@plugin "./x.ts";`).length, 1);
  assert.equal(cssDangers(`@config '../../tailwind.config.js';`).length, 1);
  assert.equal(cssDangers(`  @PLUGIN "x";`).length, 1);
  assert.equal(cssDangers(`/* c */@plugin"x";`).length, 1);
  assert.equal(cssDangers(`@source "/srv/secrets";`).length, 1);
  assert.equal(cssDangers(`@import "some-package";`).length, 1);
  assert.equal(cssDangers(`@import "../../../../etc/x.css";`).length, 1);
  assert.equal(cssDangers(`@import url("https://evil/x.css");`).length, 1);
});
