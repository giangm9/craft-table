// CSS in versions/ is compiled by Tailwind INSIDE the studio process: `@plugin` / `@config` make Tailwind load and
// RUN a JS/TS file (= running code with the server's rights: its files, environment and network). Every directive that loads
// something else is forbidden:
//   @plugin, @config, @source, and any @import other than "tailwindcss" / a relative .css file in a subfolder (no "..").
// Used in 2 layers: Claude's write/edit tools in the studio, and the Vite plugin (which also stops people editing CSS
// through the editor). Returns the directives themselves; the messages around them are worded by the callers.
const STRIP_COMMENTS = /\/\*[\s\S]*?\*\//g;
const DIRECTIVE = /@(plugin|config|source|import)\b\s*([^;{]*)/gi;

/** The dangerous directives in the CSS (empty = safe). */
export function cssDangers(css) {
  const out = [];
  for (const m of String(css ?? "").replace(STRIP_COMMENTS, "").matchAll(DIRECTIVE)) {
    const kind = m[1].toLowerCase(), arg = m[2].trim();
    if (kind !== "import") { out.push(`@${kind} ${arg}`.trim()); continue; }
    const q = /^(["'])(.*?)\1/.exec(arg);
    const target = q?.[2];
    const ok = target === "tailwindcss" || (target && /^\.\/[A-Za-z0-9._/-]+\.css$/.test(target) && !target.split("/").includes(".."));
    if (!ok) out.push(`@import ${arg}`.trim());
  }
  return out;
}
