// A craft-table PROJECT is a folder with craft-table.json plus its data: versions/<v>/{boards,system},
// threads/, data/ (history db, uploads) and optional rules/ (project rules for Claude). The tool itself (this
// package) lives elsewhere — usually node_modules/craft-table inside the project.
import fs from "node:fs";
import path from "node:path";

export const CONFIG_FILE = "craft-table.json";
const LANGUAGES = new Set(["en", "vi"]);
const SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "md", "sql"];

const fail = (dir, why) => {
  throw new Error(`${path.join(dir, CONFIG_FILE)}: ${why}`);
};

/** Optional link to the real app's source code (read-only for people and Claude). */
function cleanSource(dir, s) {
  if (s == null) return null;
  if (typeof s !== "object" || typeof s.path !== "string" || !s.path.trim()) fail(dir, "source.path must be a folder path");
  const abs = path.resolve(dir, s.path);
  const roots = s.roots ?? ["src"];
  const safeRel = (r) => typeof r === "string" && r.trim() && !path.isAbsolute(r) && !path.normalize(r).startsWith("..");
  if (!Array.isArray(roots) || !roots.length || !roots.every(safeRel)) fail(dir, "source.roots must be folders inside source.path");
  const extensions = s.extensions ?? SOURCE_EXTENSIONS;
  if (!Array.isArray(extensions) || !extensions.every((e) => typeof e === "string" && /^[a-z0-9]{1,8}$/.test(e))) fail(dir, "source.extensions must be file extensions like \"ts\"");
  return { path: abs, label: typeof s.label === "string" && s.label.trim() ? s.label.trim() : path.basename(abs), roots: roots.map((r) => path.normalize(r).split(path.sep).join("/")), extensions };
}

/** Other sites boards may load from (images, fonts): origins like "https://avatars.example", nothing else. */
function cleanOrigins(dir, list) {
  if (list == null) return [];
  const origin = (x) => { try { const u = new URL(x); return /^https?:$/.test(u.protocol) && u.origin === x ? x : null; } catch { return null; } };
  if (!Array.isArray(list) || !list.every((x) => typeof x === "string" && origin(x))) fail(dir, "\"externalOrigins\" must be a list of origins like \"https://images.example.com\" (no path)");
  return list;
}

/** { dir, config } of the project: CRAFT_PROJECT if set, else the working directory. */
export function loadProject({ cwd = process.cwd(), env = process.env } = {}) {
  const dir = path.resolve(env.CRAFT_PROJECT || cwd);
  const file = path.join(dir, CONFIG_FILE);
  if (!fs.existsSync(file)) fail(dir, "not found — run `npx craft-table init` in your project folder, or set CRAFT_PROJECT");
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { fail(dir, `not valid JSON (${e.message})`); }
  if (typeof raw?.name !== "string" || !raw.name.trim()) fail(dir, "\"name\" is required");
  const language = raw.language ?? "en";
  if (!LANGUAGES.has(language)) fail(dir, `"language" must be one of ${[...LANGUAGES].join(", ")}`);
  const logo = raw.logo ?? null;
  if (logo !== null && !(typeof logo === "string" && /^\/[A-Za-z0-9._\/-]+$/.test(logo) && !logo.split("/").includes(".."))) fail(dir, "\"logo\" must be a path served from the project's public/ folder, like \"/logo.png\"");
  return {
    dir,
    config: {
      name: raw.name.trim(),
      description: typeof raw.description === "string" ? raw.description.trim() : "",
      language,
      logo,
      source: cleanSource(dir, raw.source),
      lint: { plainLanguage: raw.lint?.plainLanguage === true },
      externalOrigins: cleanOrigins(dir, raw.externalOrigins),
    },
  };
}

/** URL prefix the browser uses for the tool's own files (HTML entries, studio UI). */
export function toolBase(toolDir, projectDir) {
  const rel = path.relative(projectDir, toolDir);
  const inside = rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  return inside ? `/${rel.split(path.sep).join("/")}` : `/@fs${toolDir.split(path.sep).join("/")}`;
}
