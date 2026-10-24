// `craft-table login`: token extraction and .env saving (ported from an earlier shell script, same cases),
// finding the Claude Code CLI, and running `setup-token` on a pseudo-terminal — with a FAKE claude: no test runs the
// real setup-token or calls any API.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import {
  extractToken, isToken, looksWrapped, saveEnvLine, envFileOf, findOnPath, findClaude, setupTokenCommand,
  captureSetupToken, askHidden, parseLoginArgs, runLogin,
} from "./login.mjs";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const BIN = path.join(REPO, "bin", "craft-table.mjs");
const TOK = "sk-ant-oat01-AbC_d-123456789012345678901234567890";
const KEY = "sk-ant-api03-Zz_y-123456789012345678901234567890";
// Real `claude setup-token` output recorded through script(1): after the token come \r, cursor moves, then text.
const SETUP_OUTPUT = `Your\x1b[1COAuth token (valid for 1 year): ${TOK}\r\x1b[1C\x1b[2B\x1b[3GStore\x1b[1Cthis token securely.\r\n`;
const SCRIPT = findOnPath("script", process.env);
// Every temp folder of this run lives under one root (checked empty by the last test, removed at the end).
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ct-login-"));
const tmp = () => fs.mkdtempSync(path.join(ROOT, "t-"));
const rmTree = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 });
// After each test: what it made.
afterEach(() => { for (const n of fs.readdirSync(ROOT)) rmTree(path.join(ROOT, n)); });
after(() => rmTree(ROOT));
const project = () => { const d = tmp(); fs.writeFileSync(path.join(d, "craft-table.json"), '{"name":"Acme"}'); return d; };
const capture = () => {
  const lines = { out: [], err: [] };
  return { lines, io: { out: (s) => lines.out.push(String(s)), err: (s) => lines.err.push(String(s)) } };
};
const mode = (f) => (fs.statSync(f).mode & 0o777).toString(8);

/** A stand-in for the Claude Code CLI: refuses anything but `setup-token`, prints the terminal size, then `body`. */
function fakeClaude(body) {
  const dir = tmp();
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, `#!/bin/sh\n[ "$1" = setup-token ] || { echo "unexpected: $*" >&2; exit 2; }\nprintf 'size=%s\\n' "$(stty size 2>/dev/null)"\n${body}\n`, { mode: 0o755 });
  return bin;
}
const printfToken = (tok = TOK) => `printf 'Your\\033[1COAuth token (valid for 1 year): ${tok}\\r\\033[1C\\033[2B\\033[3GStore\\033[1Cthis token securely.\\r\\n'`;

test("extractToken: token before \\r + cursor codes + text → exactly the token, nothing glued after it", () => {
  assert.equal(extractToken(SETUP_OUTPUT), TOK);
  // An escape code right after the token counts as a space (not removed — that would glue "more" onto the token).
  assert.equal(extractToken(`${TOK}\x1b[1Cmore`), TOK);
});

test("extractToken: several tokens → the one printed last; none → empty", () => {
  assert.equal(extractToken(`mã cũ sk-ant-oat01-cu111111111111111111111111\r\nmã mới ${TOK}\r\n`), TOK);
  assert.equal(extractToken("không có mã\r\n"), "");
  assert.equal(extractToken(""), "");
});

test("isToken: the setup-token format only (sk-ant-oat01- + at least 20 characters, nothing else)", () => {
  assert.equal(isToken(TOK), true);
  for (const bad of ["", "sk-ant-oat01-short", KEY, `${TOK}\nX=1`, ` ${TOK}`, `${TOK} x`]) assert.equal(isToken(bad), false, JSON.stringify(bad));
});

test("looksWrapped: the token continues on the next line (narrow terminal) → true; recorded output → false", () => {
  assert.equal(looksWrapped(SETUP_OUTPUT, TOK), false);
  assert.equal(looksWrapped(`a ${TOK}\r\n\r\nb ${TOK}\r\n`, TOK), false);
  const cut = TOK.slice(0, 40), rest = TOK.slice(40);
  assert.equal(isToken(cut), true, "the cut-off part alone looks like a whole token");
  assert.equal(looksWrapped(`Your OAuth token:\r\n${cut}\r\n  ${rest}\r\n\r\nStore this token securely.\r\n`, cut), true);
});

test("saveEnvLine: no file → created with just that line, mode 600", () => {
  const f = path.join(tmp(), ".env");
  saveEnvLine(f, "CLAUDE_CODE_OAUTH_TOKEN", "sk-ant-oat01-moi-1");
  assert.equal(fs.readFileSync(f, "utf8"), "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-moi-1\n");
  assert.equal(mode(f), "600");
});

test("saveEnvLine: replaces the old line, keeps the other lines, mode 600, no temp file left", () => {
  const d = tmp(), f = path.join(d, ".env");
  fs.writeFileSync(f, "KHAC=1\nCLAUDE_CODE_OAUTH_TOKEN=cu\n", { mode: 0o644 });
  saveEnvLine(f, "CLAUDE_CODE_OAUTH_TOKEN", "sk-ant-oat01-moi-2");
  assert.equal(fs.readFileSync(f, "utf8"), "KHAC=1\nCLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-moi-2\n");
  assert.equal(mode(f), "600");
  assert.deepEqual(fs.readdirSync(d), [".env"]);
  // Whatever the umask, the file ends up 600 (not narrower, not wider).
  const old = process.umask(0o277);
  try { saveEnvLine(f, "CLAUDE_CODE_OAUTH_TOKEN", "sk-ant-oat01-moi-3"); } finally { process.umask(old); }
  assert.equal(mode(f), "600");
});

test("saveEnvLine: every line the studio would read as that key is replaced (spaces, export, duplicates); others stay in order", () => {
  const f = path.join(tmp(), ".env");
  fs.writeFileSync(f, "# Claude\n  CLAUDE_CODE_OAUTH_TOKEN = old\nA=1\nexport CLAUDE_CODE_OAUTH_TOKEN=older\nCLAUDE_CODE_OAUTH_TOKEN_X=keep\nB=2");
  saveEnvLine(f, "CLAUDE_CODE_OAUTH_TOKEN", TOK);
  assert.equal(fs.readFileSync(f, "utf8"), `# Claude\nCLAUDE_CODE_OAUTH_TOKEN=${TOK}\nA=1\nCLAUDE_CODE_OAUTH_TOKEN_X=keep\nB=2\n`);
  saveEnvLine(f, "ANTHROPIC_API_KEY", KEY);
  assert.ok(fs.readFileSync(f, "utf8").endsWith(`B=2\nANTHROPIC_API_KEY=${KEY}\n`));
  assert.throws(() => saveEnvLine(f, "ANTHROPIC_API_KEY", "x\nEVIL=1"), /one line/);
});

test("envFileOf: <project>/.env, or STUDIO_ENV_FILE (the file the studio reads instead)", () => {
  assert.equal(envFileOf("/p", { cwd: "/w", env: {} }), path.join("/p", ".env"));
  assert.equal(envFileOf("/p", { cwd: "/w", env: { STUDIO_ENV_FILE: "conf/studio.env" } }), path.join("/w", "conf", "studio.env"));
});

test("findClaude: `claude` on PATH first; else the CLI shipped in the agent SDK's platform package; else null", () => {
  const bin = fakeClaude("");
  const notExec = path.join(tmp(), "claude");
  fs.writeFileSync(notExec, "x", { mode: 0o644 });
  const pathOf = (...dirs) => ({ PATH: dirs.join(path.delimiter) });
  assert.equal(findClaude({ env: pathOf(path.dirname(notExec), path.dirname(bin)), resolve: () => null }), bin);
  const sdkBin = fakeClaude("");
  const asked = [];
  const resolve = (spec) => { asked.push(spec); if (spec.endsWith("-linux-x64/claude")) return sdkBin; throw new Error("not found"); };
  assert.equal(findClaude({ env: pathOf(tmp()), platform: "linux", arch: "x64", musl: false, resolve }), sdkBin);
  assert.equal(asked[0], "@anthropic-ai/claude-agent-sdk-linux-x64/claude");
  asked.length = 0;
  assert.equal(findClaude({ env: pathOf(tmp()), platform: "linux", arch: "x64", musl: true, resolve }), sdkBin);
  assert.deepEqual(asked, ["@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude", "@anthropic-ai/claude-agent-sdk-linux-x64/claude"]);
  assert.equal(findClaude({ env: pathOf(tmp()), platform: "darwin", arch: "arm64", resolve: () => { throw new Error("x"); } }), null);
  // With the real resolver: this checkout ships the CLI for this machine.
  if (fs.existsSync(path.join(REPO, "node_modules", "@anthropic-ai", `claude-agent-sdk-${process.platform}-${process.arch}`))) {
    const found = findClaude({ env: pathOf(tmp()) });
    assert.ok(found && found.endsWith(`claude-agent-sdk-${process.platform}-${process.arch}${path.sep}claude`), String(found));
  }
});

test("setupTokenCommand: on a pseudo-terminal through script(1) — a very wide one when no terminal is attached", () => {
  const base = { bin: "/opt/it's here/claude", log: "/tmp/x/out.log", script: "/usr/bin/script" };
  const quoted = `'/opt/it'\\''s here/claude'`;
  assert.deepEqual(setupTokenCommand({ ...base, platform: "linux", interactive: false }), { cmd: "/usr/bin/script", args: ["-q", "-c", `stty cols 1000 rows 50 2>/dev/null; exec ${quoted} setup-token`, "/tmp/x/out.log"], pipe: false });
  assert.deepEqual(setupTokenCommand({ ...base, platform: "linux", interactive: true }).args[2], `exec ${quoted} setup-token`);
  assert.deepEqual(setupTokenCommand({ ...base, platform: "darwin", interactive: true }), { cmd: "/usr/bin/script", args: ["-q", "/tmp/x/out.log", "/bin/sh", "-c", `exec ${quoted} setup-token`], pipe: false });
  assert.deepEqual(setupTokenCommand({ ...base, script: null, platform: "linux" }), { cmd: base.bin, args: ["setup-token"], pipe: true });
});

test("captureSetupToken: runs the CLI on a pseudo-terminal, returns everything it printed, removes the log", { skip: !SCRIPT && "script(1) not installed" }, async () => {
  const bin = fakeClaude(printfToken());
  const logs = tmp();
  const text = await captureSetupToken({ bin, interactive: false, stdio: "ignore", tmpRoot: logs });
  assert.equal(extractToken(text), TOK);
  assert.match(text, /size=50 1000/, "no terminal attached → wide virtual screen");
  assert.deepEqual(fs.readdirSync(logs), [], "the log (it holds the token) is deleted");
});

test("captureSetupToken: without script(1) the output is piped and still captured", async () => {
  const bin = fakeClaude(printfToken());
  const text = await captureSetupToken({ bin, interactive: false, stdio: "ignore", script: null, tmpRoot: tmp() });
  assert.equal(extractToken(text), TOK);
});

test("askHidden: reads one answer without echoing it; a pasted token split over lines is joined", async () => {
  const run = async (...chunks) => {
    const input = new PassThrough(), out = new PassThrough();
    let shown = "";
    out.on("data", (c) => { shown += c; });
    const p = askHidden("Token: ", { input, output: out });
    for (const c of chunks) input.write(c);
    return { answer: await p, shown };
  };
  const a = await run(TOK, "\r");
  assert.equal(a.answer, TOK);
  assert.ok(a.shown.startsWith("Token: ") && !a.shown.includes("sk-ant"), a.shown);
  assert.equal((await run(`${TOK.slice(0, 25)}\r\n  ${TOK.slice(25)}`, "\r")).answer, TOK, "a paste is one chunk: its line breaks do not submit");
  assert.equal((await run("\u0003")).answer, "", "Ctrl+C gives up");
});

test("parseLoginArgs: [token|file] or --api-key <key>, not both", () => {
  assert.deepEqual(parseLoginArgs([]), { value: null, apiKey: null, help: false });
  assert.deepEqual(parseLoginArgs([TOK]), { value: TOK, apiKey: null, help: false });
  assert.deepEqual(parseLoginArgs(["--api-key", KEY]), { value: null, apiKey: KEY, help: false });
  assert.throws(() => parseLoginArgs([TOK, "--api-key", KEY]), /not both/);
  assert.throws(() => parseLoginArgs(["a", "b"]), /one/);
});

test("runLogin <token>: saved in <project>/.env (600); says to restart the studio", async () => {
  const dir = project();
  const { lines, io } = capture();
  assert.equal(await runLogin([TOK], { cwd: dir, env: {}, ...io }), 0);
  const f = path.join(dir, ".env");
  assert.equal(fs.readFileSync(f, "utf8"), `CLAUDE_CODE_OAUTH_TOKEN=${TOK}\n`);
  assert.equal(mode(f), "600");
  assert.match(lines.out.join("\n"), /[Rr]estart the studio/);
  assert.ok(!lines.out.join("\n").includes(TOK), "the token is never printed");
});

test("runLogin <file>: the token is taken from the saved setup-token output; no token in it → exit 1", async () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, "setup.log"), `mã cũ sk-ant-oat01-cu111111111111111111111111\r\n${SETUP_OUTPUT}`);
  assert.equal(await runLogin(["setup.log"], { cwd: dir, env: {}, ...capture().io }), 0);
  assert.equal(fs.readFileSync(path.join(dir, ".env"), "utf8"), `CLAUDE_CODE_OAUTH_TOKEN=${TOK}\n`);
  const d2 = project();
  fs.writeFileSync(path.join(d2, "empty.log"), "không có mã\r\n");
  const { lines, io } = capture();
  assert.equal(await runLogin(["empty.log"], { cwd: d2, env: {}, ...io }), 1);
  assert.match(lines.err.join("\n"), /empty\.log/);
  assert.ok(!fs.existsSync(path.join(d2, ".env")));
});

test("runLogin: a malformed token or key → exit 1, nothing written; an OAuth token passed as --api-key is refused", async () => {
  const dir = project();
  for (const argv of [["sk-ant-oat01-short"], ["hello"], ["--api-key", "nope"], ["--api-key", TOK]]) {
    const { lines, io } = capture();
    assert.equal(await runLogin(argv, { cwd: dir, env: {}, ...io }), 1, argv.join(" "));
    assert.ok(lines.err.join("\n").length > 0);
  }
  assert.ok(!fs.existsSync(path.join(dir, ".env")));
});

test("runLogin --api-key: ANTHROPIC_API_KEY line, other lines kept", async () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, ".env"), "PORT=1\n");
  assert.equal(await runLogin(["--api-key", KEY], { cwd: dir, env: {}, ...capture().io }), 0);
  assert.equal(fs.readFileSync(path.join(dir, ".env"), "utf8"), `PORT=1\nANTHROPIC_API_KEY=${KEY}\n`);
});

test("runLogin outside a project → exit 1 with how to start one", async () => {
  const { lines, io } = capture();
  assert.equal(await runLogin([TOK], { cwd: tmp(), env: {}, ...io }), 1);
  assert.match(lines.err.join("\n"), /craft-table init/);
});

test("runLogin (no argument): runs setup-token, shows it live, captures the token, saves it", { skip: !SCRIPT && "script(1) not installed" }, async () => {
  const dir = project();
  const bin = fakeClaude(printfToken());
  const { lines, io } = capture();
  const code = await runLogin([], {
    cwd: dir, env: { PATH: process.env.PATH }, interactive: false, ...io,
    findClaude: () => bin, capture: (o) => captureSetupToken({ ...o, stdio: "ignore" }),
  });
  assert.equal(code, 0, lines.err.join("\n"));
  assert.equal(fs.readFileSync(path.join(dir, ".env"), "utf8"), `CLAUDE_CODE_OAUTH_TOKEN=${TOK}\n`);
  assert.match(lines.out.join("\n"), /setup-token/);
});

test("runLogin (no argument): no CLI → exit 1 with what to do; no token captured → asks for it on a terminal, else exit 1", async () => {
  const dir = project();
  const c1 = capture();
  assert.equal(await runLogin([], { cwd: dir, env: {}, ...c1.io, findClaude: () => null }), 1);
  assert.match(c1.lines.err.join("\n"), /claude setup-token/);
  const c2 = capture();
  assert.equal(await runLogin([], { cwd: dir, env: {}, ...c2.io, interactive: false, findClaude: () => "/x/claude", capture: async () => "Error: cancelled\r\n" }), 1);
  assert.ok(!fs.existsSync(path.join(dir, ".env")));
  const asked = [];
  const c3 = capture();
  const cut = TOK.slice(0, 40);
  assert.equal(await runLogin([], {
    cwd: dir, env: {}, ...c3.io, interactive: true, findClaude: () => "/x/claude",
    capture: async () => `${cut}\r\n${TOK.slice(40)}\r\n`, ask: async (q) => { asked.push(q); return TOK; },
  }), 0);
  assert.equal(asked.length, 1, "a token cut by line wrapping is not trusted: ask for it");
  assert.equal(fs.readFileSync(path.join(dir, ".env"), "utf8"), `CLAUDE_CODE_OAUTH_TOKEN=${TOK}\n`);
});

test("CLI: `craft-table login <token>` in a project → .env written, exit 0; bad token → exit 1", () => {
  const dir = project();
  const ok = spawnSync(process.execPath, [BIN, "login", TOK], { cwd: dir, encoding: "utf8", env: { ...process.env, CRAFT_PROJECT: "", STUDIO_ENV_FILE: "" } });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(fs.readFileSync(path.join(dir, ".env"), "utf8"), `CLAUDE_CODE_OAUTH_TOKEN=${TOK}\n`);
  const bad = spawnSync(process.execPath, [BIN, "login", "nope"], { cwd: dir, encoding: "utf8", env: { ...process.env, CRAFT_PROJECT: "", STUDIO_ENV_FILE: "" } });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /sk-ant-oat01/);
});

// Keep last: by now every earlier test has removed its temp folders.
test("temp folders: no test leaves one behind", () => {
  assert.deepEqual(fs.readdirSync(ROOT), []);
});
