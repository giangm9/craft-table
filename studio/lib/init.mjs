// `craft-table init [folder] [--name <name>] [--lang en|vi]`: a new project from the starter template
// (studio/templates/starter/). Template files are copied as they are, with {{name}} / {{language}} filled in — in
// .json/.ts/.tsx files the placeholder sits inside a "…" literal, so the value is escaped as a JSON string there.
// versions/main/version.json is written here: its status comes from versions.mjs, its date is now.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CONFIG_FILE } from "./project.mjs";
import { VERSION_STATUSES } from "./versions.mjs";

export const TEMPLATE_DIR = path.resolve(import.meta.dirname, "..", "templates", "starter");
const LANGUAGES = ["en", "vi"]; // what project.mjs accepts
const VERSION = "main";
const LIVE_STATUS = VERSION_STATUSES[2]; // "live / in the app": the status setLive gives a version
// npm drops .gitignore files from published packages, so the template keeps it without the dot.
const RENAME = { gitignore: ".gitignore" };

export const USAGE = `Usage: craft-table init [folder] [--name <name>] [--lang en|vi]

Creates a craft-table project in <folder> (default: the current folder): craft-table.json,
versions/main (a small design system and a welcome screen) and .gitignore.
  --name <name>   project name (default: the folder name)
  --lang en|vi    the project's language: the studio's default language and Claude's instructions (default: en)`;

export class InitError extends Error {}

/** argv after "init" → { folder, name, language, help }; bad input → InitError. */
export function parseInitArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { name: { type: "string" }, lang: { type: "string" }, help: { type: "boolean", short: "h" } } });
  } catch (e) {
    throw new InitError(e.message);
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) throw new InitError(`expected at most one folder, got: ${positionals.join(" ")}`);
  const language = values.lang ?? "en";
  if (!LANGUAGES.includes(language)) throw new InitError(`--lang must be ${LANGUAGES.join(" or ")}, not "${language}"`);
  let name = null;
  if (values.name !== undefined) {
    name = values.name.trim();
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new InitError("--name must be one line of text (1–100 characters)");
  }
  return { folder: positionals[0] ?? null, name, language, help: values.help === true };
}

function templateFiles() {
  return fs.readdirSync(TEMPLATE_DIR, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(TEMPLATE_DIR, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .sort();
}

function fill(text, vars, rel) {
  const quoted = /\.(json|tsx?)$/.test(rel);
  return text.replace(/\{\{(name|language)\}\}/g, (_, k) => (quoted ? JSON.stringify(vars[k]).slice(1, -1) : vars[k]));
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** Create .gitignore, or add the lines it lacks to an existing one → "created" | "updated" | "unchanged". */
function mergeGitignore(file, template) {
  if (!fs.existsSync(file)) { write(file, template); return "created"; }
  const cur = fs.readFileSync(file, "utf8");
  const norm = (l) => l.trim().replace(/^\//, "").replace(/\/$/, "");
  const have = new Set(cur.split("\n").map(norm));
  const missing = template.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !have.has(norm(l)));
  if (!missing.length) return "unchanged";
  fs.writeFileSync(file, `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}# craft-table\n${missing.join("\n")}\n`);
  return "updated";
}

/**
 * Write the starter project into `dir` (created if missing). Refuses (InitError) when the folder already is a project
 * or already has versions/. → { dir, name, language, gitignore }
 */
export function initProject(dir, { name = null, language = "en", now = new Date() } = {}) {
  dir = path.resolve(dir);
  if (!LANGUAGES.includes(language)) throw new InitError(`language must be ${LANGUAGES.join(" or ")}`);
  if (fs.existsSync(path.join(dir, CONFIG_FILE))) throw new InitError(`${CONFIG_FILE} already exists in ${dir} — this folder is already a craft-table project (start it with: npx craft-table start).`);
  if (fs.existsSync(path.join(dir, "versions"))) throw new InitError(`${dir} already has a versions/ folder — init does not write into it. Use an empty folder.`);
  const vars = { name: (name ?? path.basename(dir)).trim() || "My project", language };
  fs.mkdirSync(dir, { recursive: true });
  let config = null, gitignore = "unchanged";
  for (const rel of templateFiles()) {
    const text = fill(fs.readFileSync(path.join(TEMPLATE_DIR, rel), "utf8"), vars, rel);
    const out = RENAME[rel] ?? rel;
    if (out === ".gitignore") gitignore = mergeGitignore(path.join(dir, out), text);
    else if (out === CONFIG_FILE) config = text;
    else write(path.join(dir, out), text);
  }
  const version = { id: VERSION, title: "Main", status: LIVE_STATUS, from: null, createdAt: now.toISOString(), createdBy: "craft-table init", note: "" };
  write(path.join(dir, "versions", VERSION, "version.json"), JSON.stringify(version, null, 2) + "\n");
  // Last: a folder left half-made by an error is not mistaken for a project.
  write(path.join(dir, CONFIG_FILE), config);
  return { dir, name: vars.name, language, gitignore };
}

function dependsOnCraftTable(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return ["dependencies", "devDependencies", "optionalDependencies"].some((k) => pkg?.[k]?.["craft-table"]);
  } catch {
    return false;
  }
}

const shellArg = (s) => (/^[\w./@+-]+$/.test(s) ? s : JSON.stringify(s));

/** What to run next, from the folder `init` ran in. */
export function nextSteps({ dir, cwd, env = {} }) {
  const steps = [];
  const rel = path.relative(cwd, dir);
  if (rel) steps.push([`cd ${shellArg(rel)}`, ""]);
  if (!dependsOnCraftTable(dir)) {
    if (!fs.existsSync(path.join(dir, "package.json"))) steps.push(["npm init -y", "so the install lands in this folder"]);
    steps.push(["npm i -D craft-table", "install the studio"]);
  }
  steps.push(["npx craft-table start", `then open http://localhost:${env.STUDIO_PORT || 5180}`]);
  steps.push(["npx craft-table login", "connect Claude, your design partner in the studio"]);
  const w = Math.max(...steps.map(([c]) => c.length));
  return ["Next steps:", ...steps.map(([c, why]) => `  ${why ? `${c.padEnd(w)}   ${why}` : c}`)].join("\n");
}

/** The `init` command → exit code. */
export function runInit(argv, { cwd = process.cwd(), env = process.env, out = console.log, err = console.error, now = new Date() } = {}) {
  let args;
  try {
    args = parseInitArgs(argv);
  } catch (e) {
    err(`craft-table init: ${e.message}\n\n${USAGE}`);
    return 1;
  }
  if (args.help) { out(USAGE); return 0; }
  const dir = path.resolve(cwd, args.folder ?? ".");
  let r;
  try {
    r = initProject(dir, { name: args.name, language: args.language, now });
  } catch (e) {
    err(`craft-table init: ${e.message}`);
    return 1;
  }
  const rel = path.relative(cwd, dir);
  const where = rel ? shellArg(rel) : "this folder";
  out(`Created the craft-table project "${r.name}" in ${where}:`);
  out(`  craft-table.json, versions/main (a small design system and a welcome screen), .gitignore (${r.gitignore})\n`);
  out(nextSteps({ dir, cwd, env }));
  return 0;
}
