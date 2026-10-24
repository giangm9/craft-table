// The studio chrome has its own neutral theme (studio/ui/tokens.css) and favicon: nothing in it may come from
// the first project that used the tool. Colours are checked with the WCAG 2 contrast formula.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const STUDIO = path.resolve(import.meta.dirname, "..");
const TOKENS = path.join(STUDIO, "ui", "tokens.css");
const PAGES = ["index.html", "spec.html", "versions.html"];
const COMMENTS = /\/\*[\s\S]*?\*\//g;
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const WHITE = "#ffffff";

const css = fs.readFileSync(TOKENS, "utf8");
const code = css.replace(COMMENTS, "");
const vars = (block) => Object.fromEntries([...block.matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = vars(/@theme static\s*\{([^}]*)\}/.exec(code)?.[1] ?? "");
const dark = Object.assign({}, ...[...code.matchAll(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/g)].map((m) => vars(m[1])));

const rgb = (hex) => {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `expected a #rrggbb colour, got ${hex}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
};
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => { const [r, g, b] = rgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
/** Hue in degrees and chroma (max - min channel, 0..1: how far from a pure grey). */
const hue = (hex) => {
  const [r, g, b] = rgb(hex), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return { h: 0, c: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, c: d };
};
/** A cool slate grey: blue-grey hue, little colour. */
const slateIssue = (label, hex) => {
  const { h, c } = hue(hex);
  return h >= 195 && h <= 235 && c <= 0.2 ? null : `${label} ${hex} is not a cool slate grey (hue ${h.toFixed(0)}, chroma ${c.toFixed(2)})`;
};
/** Ink steps that are not cool slate greys, or break the ramp order (light: darker per step; dark: lighter). */
const inkIssues = (theme, label, darker) => [
  ...STEPS.map((s) => slateIssue(`${label}ink-${s}`, theme[`ink-${s}`])),
  ...STEPS.slice(1).map((s, i) => ((lum(theme[`ink-${s}`]) < lum(theme[`ink-${STEPS[i]}`])) === darker ? null : `${label}ink-${s} out of ramp order`)),
].filter(Boolean);
const pairs = (theme, list) => list.map(([label, fg, bg, min]) => [label, contrast(fg(theme), bg(theme)), min]);
const failing = (rows) => rows.filter(([, c, min]) => c < min).map(([label, c, min]) => `${label}: ${c.toFixed(2)} < ${min}`);
const t = (step) => (theme) => theme[step];
const white = () => WHITE;
/** ink-400 is small text all over the studio (section headers, counts, list numbers, placeholders),
    so it needs AA on every plane it sits on: surface, page (ink-50) and chips / hover rows (ink-100). */
const mutedText = [
  ["ink-400 text on surface", t("ink-400"), t("surface"), 4.5],
  ["ink-400 text on surface-2", t("ink-400"), t("surface-2"), 4.5],
  ["ink-400 text on page (ink-50)", t("ink-400"), t("ink-50"), 4.5],
  ["ink-400 text on chip (ink-100)", t("ink-400"), t("ink-100"), 4.5],
  // Secondary (500) must still read as a step stronger than muted (400).
  ["ink-500 vs ink-400 step", t("ink-500"), t("ink-400"), 1.25],
];

test("every token the studio UI uses is defined for light and dark", () => {
  const names = [...STEPS.flatMap((s) => [`ink-${s}`, `accent-${s}`]), "surface", "surface-2"];
  assert.deepEqual(names.filter((n) => !light[n]), [], "missing in @theme");
  assert.deepEqual(names.filter((n) => !dark[n]), [], 'missing in :root[data-theme="dark"]');
});

test("accent is indigo / blue-violet, and 600 + 700 pass AA (4.5:1) against white", () => {
  const hues = [500, 600, 700, 800].map((s) => [s, light[`accent-${s}`], hue(light[`accent-${s}`]).h])
    .filter(([, , h]) => h < 228 || h > 268).map(([s, hex, h]) => `accent-${s} ${hex} has hue ${h.toFixed(0)}, not indigo/blue-violet`);
  assert.deepEqual([...hues, ...failing(pairs(light, [
    ["accent-600 text on white", t("accent-600"), white, 4.5],
    // Also the active sidebar row: every label on it is plain white on accent-700 (Sidebar.tsx), never translucent.
    ["accent-700 text on white / white on primary", t("accent-700"), white, 4.5],
    ["white on primary hover (accent-800)", white, t("accent-800"), 4.5],
    ["accent-700 link on page (ink-50)", t("accent-700"), t("ink-50"), 4.5],
    ["accent-700 on selected (accent-50)", t("accent-700"), t("accent-50"), 4.5],
    ["accent-800 on selected (accent-50)", t("accent-800"), t("accent-50"), 4.5],
    ["accent-500 focus border on white", t("accent-500"), white, 3],
  ]))], []);
});

test("light ink is a cool slate ramp whose text steps are readable", () => {
  assert.deepEqual([...inkIssues(light, "", true), ...failing(pairs(light, [
    ...[900, 800, 700, 600, 500].map((s) => [`ink-${s} on surface`, t(`ink-${s}`), t("surface"), 4.5]),
    ["ink-500 on page (ink-50)", t("ink-500"), t("ink-50"), 4.5],
    ["ink-500 on chip (ink-100)", t("ink-500"), t("ink-100"), 4.5],
    ...mutedText,
  ]))], []);
});

test("dark overrides stay readable: cool slate inks, white on primary, light accent text", () => {
  assert.deepEqual([...inkIssues(dark, "dark ", false), ...(lum(dark.surface) > lum(dark["ink-50"]) ? [] : ["dark surface must sit above the page (ink-50)"]), ...failing(pairs(dark, [
    ["ink-900 on surface", t("ink-900"), t("surface"), 12],
    ...[800, 700, 600, 500].map((s) => [`ink-${s} on surface`, t(`ink-${s}`), t("surface"), 4.5]),
    ["ink-500 on page (ink-50)", t("ink-500"), t("ink-50"), 4.5],
    ["ink-500 on chip (ink-100)", t("ink-500"), t("ink-100"), 4.5],
    ...mutedText,
    ["white on primary (accent-700)", white, t("accent-700"), 4.5],
    ["white on primary hover (accent-800)", white, t("accent-800"), 3],
    ["accent-800 text on surface", t("accent-800"), t("surface"), 4.5],
    ["accent-800 text on selected (accent-50)", t("accent-800"), t("accent-50"), 4.5],
    ["accent-700 link on surface", t("accent-700"), t("surface"), 3.5],
    ["accent-600 marker border on surface", t("accent-600"), t("surface"), 3],
    // Tailwind fills that carry white text: danger button + count badge, Claude's marker badge.
    ["white on danger / count badge (rose-600)", white, t("rose-600"), 4.5],
    ["white on Claude marker badge (sky-600)", white, t("sky-600"), 4.5],
    ["rose-600 error text on surface", t("rose-600"), t("surface"), 3.5],
    ["sky-600 text on surface", t("sky-600"), t("surface"), 3.5],
  ]))], []);
});

test("tokens.css comments are plain English with no trace of a product brand", () => {
  const bad = (css.match(COMMENTS) ?? []).filter((c) => /[^\x00-\x7f]/.test(c) || /\b(?:brand(?:s|ed|ing)?|logo(?:s|type)?|marketing|landing page|campaign)\b/i.test(c));
  assert.deepEqual(bad.map((c) => c.slice(0, 90)), []);
});

test("tokens.css only styles classes and hooks the studio actually uses", () => {
  const sources = [path.join(STUDIO, "src"), path.join(STUDIO, "ui")]
    .flatMap((d) => fs.readdirSync(d).filter((f) => /\.(tsx?|mjs)$/.test(f)).map((f) => fs.readFileSync(path.join(d, f), "utf8")))
    .join("\n");
  const used = (name) => new RegExp(`["'\`\\s]${name}["'\`\\s=]`).test(sources);
  // Selector text = whatever precedes a "{" (declarations end with ";" or "}").
  const selectors = [...code.matchAll(/([^{};]+)\{/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith("@"));
  const classes = new Set(selectors.flatMap((s) => [...s.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1])));
  const hooks = new Set(selectors.flatMap((s) => [...s.matchAll(/\[(data-[\w-]+)/g)].map((m) => m[1])).filter((h) => h !== "data-theme"));
  assert.deepEqual([...classes, ...hooks].filter((n) => !used(n)), []);
});

test(".font-brand (project name in the sidebar) keeps a neutral serif stack", () => {
  const rule = /\.font-brand\s*\{([^}]*)\}/.exec(code)?.[1] ?? "";
  assert.match(rule, /font-family:[^;]*\bserif\s*;/);
});

test("studio pages use the inline craft-table favicon and a generic title", () => {
  const icons = PAGES.map((p) => {
    const html = fs.readFileSync(path.join(STUDIO, p), "utf8");
    assert.match(html, /<title>craft-table<\/title>/, `${p}: generic title`);
    assert.doesNotMatch(html, /\/icons\//, `${p}: must not point at a project's icon files`);
    const links = [...html.matchAll(/<link\b[^>]*\brel="icon"[^>]*>/g)].map((m) => m[0]);
    assert.equal(links.length, 1, `${p}: one icon link`);
    assert.match(links[0], /\btype="image\/svg\+xml"/, `${p}: icon type`);
    return /\bhref="([^"]+)"/.exec(links[0])?.[1] ?? "";
  });
  assert.equal(new Set(icons).size, 1, "the three pages share one favicon");
  assert.ok(icons[0].startsWith("data:image/svg+xml,"), "favicon is an inline SVG data: URI");
  const svg = decodeURIComponent(icons[0].slice("data:image/svg+xml,".length));
  assert.match(svg, /^<svg\b[^>]*\bxmlns='http:\/\/www\.w3\.org\/2000\/svg'/);
  assert.match(svg, /<\/svg>$/);
  const accents = [light["accent-600"], light["accent-700"]].map((c) => c?.toLowerCase());
  assert.ok(accents.some((c) => c && svg.toLowerCase().includes(c)), `favicon uses the accent colour (${accents.join(" or ")})`);
});
