// `craft-table login [token|file] [--api-key <key>]`: credentials for the studio's Claude, saved in the project's
// .env (the file the studio loads at start; STUDIO_ENV_FILE when that is set).
//   no argument  run `claude setup-token` (Claude Code CLI on PATH, else the one shipped with the agent SDK) on a
//                pseudo-terminal through script(1): its screen is shown live and logged, then the token is read from
//                the log — the last sk-ant-oat01-… after escape codes become spaces and \r becomes a line break
//   <file>       saved setup-token output → the same extraction
//   <token>      the token itself (format checked)
//   --api-key    an Anthropic API key instead (ANTHROPIC_API_KEY)
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadProject } from "./project.mjs";

export const TOKEN_KEY = "CLAUDE_CODE_OAUTH_TOKEN";
export const API_KEY_KEY = "ANTHROPIC_API_KEY";
const SDK = "@anthropic-ai/claude-agent-sdk";

export const USAGE = `Usage: craft-table login [token|file] [--api-key <key>]

Connects the studio's Claude; the credential is saved in the project's .env (readable only by you).
  (no argument)     run \`claude setup-token\`: sign in with your Claude subscription, the token is saved
  <token>           a token printed by \`claude setup-token\` (sk-ant-oat01-…)
  <file>            a file holding the output of \`claude setup-token\`
  --api-key <key>   use an Anthropic API key instead (sk-ant-…)`;

// ── Token text ───────────────────────────────────────────────────────────────

/** Terminal output as plain lines: escape codes → a space (never glue the text around them), \r → line break. */
const plain = (text) => String(text ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, " ").replace(/\r/g, "\n");

/** The last setup-token token in terminal output; "" when there is none. */
export function extractToken(text) {
  return plain(text).match(/sk-ant-oat01-[A-Za-z0-9_-]+/g)?.at(-1) ?? "";
}

export const isToken = (s) => typeof s === "string" && /^sk-ant-oat01-[A-Za-z0-9_-]{20,}$/.test(s);
const looksLikeApiKey = (s) => typeof s === "string" && /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(s) && !s.startsWith("sk-ant-oat");

/** Does the token seem to go on over the next line (a narrow terminal wrapped it)? Then it was captured cut short. */
export function looksWrapped(text, token) {
  const s = plain(text);
  const at = s.lastIndexOf(token);
  if (at < 0 || !token) return false;
  const rest = s.slice(at + token.length);
  if (!/^[ \t]*\n/.test(rest)) return false;
  const next = rest.split("\n").map((l) => l.trim()).find(Boolean);
  return next !== undefined && /^[A-Za-z0-9_-]+$/.test(next);
}

// ── .env ─────────────────────────────────────────────────────────────────────

/** The env file the studio reads: STUDIO_ENV_FILE if set, else <project>/.env. */
export function envFileOf(projectDir, { cwd = process.cwd(), env = process.env } = {}) {
  return env.STUDIO_ENV_FILE ? path.resolve(cwd, env.STUDIO_ENV_FILE) : path.join(projectDir, ".env");
}

/**
 * Set KEY=value in an env file: the first line the studio would read as KEY is replaced (later duplicates dropped),
 * or the line is added at the end; other lines stay. Written to a temp file (mode 600) and renamed over the old one.
 */
export function saveEnvLine(file, key, value) {
  if (/[\r\n]/.test(value)) throw new Error(`${key} must be one line`);
  const same = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  let lines = [];
  try { lines = fs.readFileSync(file, "utf8").split("\n"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (lines.at(-1) === "") lines.pop();
  const line = `${key}=${value}`;
  const at = lines.findIndex((l) => same.test(l));
  const next = at < 0 ? [...lines, line] : lines.flatMap((l, i) => (i === at ? [line] : same.test(l) ? [] : [l]));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${next.join("\n")}\n`, { mode: 0o600, flag: "wx" });
  try {
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

// ── Finding and running the Claude Code CLI ──────────────────────────────────

/** An executable `name` on PATH, or null. */
export function findOnPath(name, env = process.env, platform = process.platform) {
  const exts = platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""];
  for (const dir of String(env.PATH ?? env.Path ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const f = path.join(dir, name + ext);
      try {
        fs.accessSync(f, fs.constants.X_OK);
        if (fs.statSync(f).isFile()) return f;
      } catch { /* not here */ }
    }
  }
  return null;
}

const isMusl = () => {
  if (process.platform !== "linux") return false;
  const report = typeof process.report?.getReport === "function" ? process.report.getReport() : null;
  return report != null && report.header?.glibcVersionRuntime === undefined;
};

/** Resolve a package file the way the agent SDK finds its own CLI (from the SDK's folder). */
function resolveFromSdk(spec) {
  return createRequire(fileURLToPath(import.meta.resolve(SDK))).resolve(spec);
}

/**
 * The Claude Code CLI: `claude` on PATH, else the binary in the agent SDK's platform package
 * (@anthropic-ai/claude-agent-sdk-<platform>-<arch>[-musl]/claude), else null.
 */
export function findClaude({ env = process.env, platform = process.platform, arch = process.arch, musl, resolve = resolveFromSdk } = {}) {
  const onPath = findOnPath("claude", env, platform);
  if (onPath) return onPath;
  const libc = platform === "linux" ? ((musl ?? isMusl()) ? ["-musl", ""] : ["", "-musl"]) : [""];
  const exe = platform === "win32" ? ".exe" : "";
  for (const suffix of libc) {
    try {
      const f = resolve(`${SDK}-${platform}-${arch}${suffix}/claude${exe}`);
      if (f && fs.existsSync(f)) return f;
    } catch { /* that package is not installed */ }
  }
  return null;
}

const shq = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

/**
 * How to run `<bin> setup-token` so its screen is shown live and also logged to `log`: through script(1), which gives
 * it a pseudo-terminal (its interactive screen needs one). With no terminal attached (answers piped in) the virtual
 * screen is made very wide, so neither the sign-in link nor the token is wrapped. No script(1) → plain pipes.
 */
export function setupTokenCommand({ bin, log, platform = process.platform, interactive = false, script = null }) {
  if (!script) return { cmd: bin, args: ["setup-token"], pipe: true };
  const line = `${interactive ? "" : "stty cols 1000 rows 50 2>/dev/null; "}exec ${shq(bin)} setup-token`;
  const bsd = ["darwin", "freebsd", "openbsd", "netbsd"].includes(platform);
  return bsd
    ? { cmd: script, args: ["-q", log, "/bin/sh", "-c", line], pipe: false }
    : { cmd: script, args: ["-q", "-c", line, log], pipe: false };
}

const exitOf = (child) => new Promise((resolve) => {
  child.once("error", (error) => resolve({ code: null, error }));
  child.once("close", (code) => resolve({ code, error: null }));
});

/**
 * Run `<bin> setup-token`, showing its screen (stdio "inherit") and capturing everything it prints → that text.
 * The log lives in a private temp folder that is always deleted (it holds the token).
 */
export async function captureSetupToken({
  bin, interactive = Boolean(process.stdin.isTTY), platform = process.platform, env = process.env,
  script = findOnPath("script", env, platform), stdio = "inherit", tmpRoot = os.tmpdir(),
}) {
  const dir = fs.mkdtempSync(path.join(tmpRoot, "craft-table-login-"));
  const log = path.join(dir, "setup-token.log");
  try {
    fs.writeFileSync(log, "", { mode: 0o600 });
    const c = setupTokenCommand({ bin, log, platform, interactive, script });
    if (!c.pipe) {
      // script(1) runs the line with $SHELL -c: make that a POSIX shell.
      const r = await exitOf(spawn(c.cmd, c.args, { stdio, env: { ...env, SHELL: "/bin/sh" } }));
      if (r.error) throw r.error;
      return fs.readFileSync(log, "utf8");
    }
    const shell = platform === "win32" && /\.(cmd|bat)$/i.test(bin);
    const child = spawn(shell ? `"${bin}"` : bin, c.args, { stdio: [stdio === "inherit" ? "inherit" : "ignore", "pipe", "pipe"], env, shell });
    let text = "";
    child.stdout.on("data", (d) => { text += d; if (stdio === "inherit") process.stdout.write(d); });
    child.stderr.on("data", (d) => { text += d; if (stdio === "inherit") process.stderr.write(d); });
    const r = await exitOf(child);
    if (r.error) throw r.error;
    return text;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Ask on the terminal without echoing the answer. Enter pressed on its own submits; line breaks inside a paste
 * (one chunk of input) do not, so a token shown over several lines can be pasted whole. Whitespace is removed.
 * Ctrl+C → "".
 */
export function askHidden(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    output.write(question);
    let buf = "";
    const raw = typeof input.setRawMode === "function";
    if (raw) input.setRawMode(true);
    input.setEncoding?.("utf8");
    const done = (answer) => {
      input.off("data", onData);
      if (raw) input.setRawMode(false);
      input.pause();
      output.write("\n");
      resolve(answer.replace(/\s+/g, ""));
    };
    const onData = (chunk) => {
      const s = String(chunk);
      if (s.includes("\u0003")) return done("");
      if (s === "\r" || s === "\n" || s === "\r\n") return done(buf);
      if (s === "\u007f" || s === "\b") { buf = buf.slice(0, -1); return; }
      buf += s.replace(/\x1b\[20[01]~/g, ""); // bracketed-paste markers
    };
    input.on("data", onData);
    input.resume();
  });
}

// ── The command ──────────────────────────────────────────────────────────────

/** argv after "login" → { value, apiKey, help }; bad input → Error. */
export function parseLoginArgs(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { "api-key": { type: "string" }, help: { type: "boolean", short: "h" } } });
  if (positionals.length > 1) throw new Error(`expected one token or file, got ${positionals.length} arguments`);
  const apiKey = values["api-key"] ?? null;
  if (apiKey !== null && positionals.length) throw new Error("pass a token (or file) or --api-key, not both");
  return { value: positionals[0] ?? null, apiKey, help: values.help === true };
}

function readableFile(p) {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

const AFTER_SAVE = "Restart the studio so Claude uses it: stop it (Ctrl+C), then run npx craft-table start again.";

/** The `login` command → exit code. Every outside effect can be replaced in tests (no real setup-token, no API). */
export async function runLogin(argv, {
  cwd = process.cwd(), env = process.env, out = console.log, err = console.error,
  interactive = Boolean(process.stdin.isTTY), findClaude: find = findClaude, capture = captureSetupToken, ask = askHidden,
} = {}) {
  const fail = (msg) => { err(`craft-table login: ${msg}`); return 1; };
  let args;
  try {
    args = parseLoginArgs(argv);
  } catch (e) {
    err(`craft-table login: ${e.message}\n\n${USAGE}`);
    return 1;
  }
  if (args.help) { out(USAGE); return 0; }
  let project;
  try {
    project = loadProject({ cwd, env });
  } catch (e) {
    return fail(e.message);
  }
  const file = envFileOf(project.dir, { cwd, env });
  const shown = path.relative(cwd, file).startsWith("..") ? file : path.relative(cwd, file) || file;
  const save = (key, value) => {
    try {
      saveEnvLine(file, key, value);
    } catch (e) {
      return fail(`could not write ${file}: ${e.message}`);
    }
    out(`✓ Saved ${key} in ${shown} (readable only by you).`);
    return 0;
  };

  if (args.apiKey !== null) {
    if (isToken(args.apiKey)) return fail("that is a Claude Code token, not an API key — run: npx craft-table login <token>");
    if (!looksLikeApiKey(args.apiKey)) return fail("that does not look like an Anthropic API key (sk-ant-…).");
    if (save(API_KEY_KEY, args.apiKey)) return 1;
    out(AFTER_SAVE);
    return 0;
  }

  let token;
  if (args.value !== null) {
    const p = path.resolve(cwd, args.value);
    if (readableFile(p)) {
      token = extractToken(fs.readFileSync(p, "utf8"));
      if (!token) return fail(`no Claude token (sk-ant-oat01-…) found in ${args.value}.`);
    } else {
      token = args.value.trim();
    }
    if (!isToken(token)) return fail("that is not a token from `claude setup-token` (it starts with sk-ant-oat01-).");
  } else {
    const bin = find({ env });
    if (!bin) return fail("the Claude Code CLI was not found. Install it (npm i -g @anthropic-ai/claude-code), or run `claude setup-token` on any computer and then: npx craft-table login <token>");
    out(`Running ${bin} setup-token — open the link it shows, sign in to Claude and allow access (needs a Claude subscription).\n`);
    let text;
    try {
      text = await capture({ bin, interactive, env });
    } catch (e) {
      return fail(`could not run ${bin} setup-token: ${e.message}`);
    }
    token = extractToken(text);
    if (!isToken(token) || looksWrapped(text, token)) {
      token = interactive ? await ask("Could not read the whole token from the screen. Paste it here (input hidden; it may span several lines), then press Enter: ") : "";
      if (!isToken(token)) return fail("no usable token. Run `claude setup-token`, copy the token it prints, then: npx craft-table login <token>");
    }
  }
  if (save(TOKEN_KEY, token)) return 1;
  try {
    if (/^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=\s*\S/m.test(fs.readFileSync(file, "utf8"))) out(`Note: ${shown} also sets ANTHROPIC_API_KEY — remove that line if Claude should sign in with this token.`);
  } catch { /* just written; nothing to add */ }
  out(AFTER_SAVE);
  return 0;
}
