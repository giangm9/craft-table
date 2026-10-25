// The SANDBOX for the scripts of a whole-design turn: Claude hands over a shell command (node, python, sed … — whatever the
// machine has), it runs in a THROWAWAY COPY of the version's boards/ and system/, and what it leaves behind is checked file by
// file against the write rules (write-guard.mjs) before any of it lands in the real version. Nothing a script does can reach
// the version except through that check: a file of another type, a symlink, CSS that runs code, version.json, a file outside
// boards/ and system/ is refused and reported; a file the person changed meanwhile is a conflict and the person's change stays.
//
// Where the command runs (how isolated it is) depends on the machine — CRAFT_SANDBOX:
//   (unset / auto)  bwrap (bubblewrap) when it exists AND is allowed to run here; otherwise scripts are OFF
//   bwrap           the command runs in a new user/pid/net/ipc namespace: no network, only the system read-only and the copy writable
//   docker          `docker run --network none --cap-drop ALL …` with only the copy mounted (CRAFT_SANDBOX_IMAGE, default node:22-slim)
//   process         NO isolation from the machine: a child process as the unprivileged user "nobody" (when the studio runs as root),
//                   an empty environment (no tokens or keys), its own home, time and output limits — but the network and every file
//                   "nobody" may read stay reachable. Only for a studio nobody else can reach.
//   off             scripts are off
// Never chosen by itself: `process` and `docker` (they must be asked for).
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writableRel, contentIssue } from "./write-guard.mjs";

const NOBODY = 65534;
const MAX_FILE = 1_500_000;     // bytes of one file a script may leave behind
const MAX_CHANGED = 2000;       // changed files per command
const SCRATCH_PREFIX = "craft-sandbox-";
const SYSTEM_BINDS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc/alternatives"];

/** Full path of an executable on PATH, or null. */
export function whichSync(name, pathEnv = process.env.PATH ?? "") {
  for (const d of pathEnv.split(":")) {
    if (!d) continue;
    const p = path.join(d, name);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
}

/** bwrap exists but may still refuse to run (no user namespaces in this container): try it once. */
export function probeBwrap() {
  try { return spawnSync("bwrap", ["--unshare-all", "--ro-bind", "/", "/", "true"], { timeout: 5000 }).status === 0; } catch { return false; }
}

/** Which backend this machine uses → { backend: "bwrap" | "docker" | "process" | null, reason } (reason: one sentence for the log and the UI). */
export function detectBackend({ env = process.env, which = whichSync, probe = probeBwrap } = {}) {
  const want = String(env.CRAFT_SANDBOX ?? "auto").trim().toLowerCase();
  if (want === "off") return { backend: null, reason: "scripts are off (CRAFT_SANDBOX=off)" };
  if (want === "process") return { backend: "process", reason: "CRAFT_SANDBOX=process — an unprivileged child process, NO isolation from the network or the machine's readable files" };
  if (want === "docker") return which("docker") ? { backend: "docker", reason: "CRAFT_SANDBOX=docker" } : { backend: null, reason: "CRAFT_SANDBOX=docker but docker was not found" };
  if (want === "bwrap" || want === "auto" || want === "") {
    if (which("bwrap") && probe()) return { backend: "bwrap", reason: want === "auto" || want === "" ? "bwrap found" : "CRAFT_SANDBOX=bwrap" };
    return { backend: null, reason: which("bwrap") ? "bwrap is installed but cannot start here (no user namespaces)" : "no isolated sandbox: install bwrap (bubblewrap), or set CRAFT_SANDBOX=docker / process" };
  }
  return { backend: null, reason: `unknown CRAFT_SANDBOX value "${want}" (auto, bwrap, docker, process, off)` };
}

/** The arguments of `bwrap` for one command: no network, the system read-only, only `workDir` (as /work) and `homeDir` writable. */
export function buildBwrapArgs({ workDir, homeDir, command, shell = "/bin/bash" }) {
  return [
    "--unshare-all", "--die-with-parent", "--new-session",
    ...SYSTEM_BINDS.flatMap((d) => ["--ro-bind-try", d, d]),
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    "--bind", workDir, "/work",
    "--bind", homeDir, "/home/sandbox",
    "--setenv", "HOME", "/home/sandbox", "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin", "--setenv", "LANG", "C.UTF-8",
    "--chdir", "/work",
    shell, "-c", command,
  ];
}

/** The arguments of `docker` for one command: no network, no capabilities, limited memory / processes, only `workDir` mounted. */
export function buildDockerArgs({ workDir, image = "node:22-slim", command, memory = "1g", cpus = "2", pids = 256 }) {
  return [
    "run", "--rm", "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--memory", memory, "--cpus", cpus, "--pids-limit", String(pids), "--user", `${NOBODY}:${NOBODY}`,
    "-v", `${workDir}:/work`, "-w", "/work",
    image, "/bin/bash", "-c", command,
  ];
}

const hashOf = (buf) => crypto.createHash("sha1").update(buf).digest("hex");

/** rel → sha1 of every regular file under `dir` (symlinks are not followed and not listed; dotfiles and node_modules are skipped). */
function snapshot(dir, { symlinks = null } = {}) {
  const out = new Map();
  const walk = (d, rel) => {
    let items;
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of items) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name.endsWith(".tmp")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) { symlinks?.push(r); continue; }
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile()) { try { out.set(r, hashOf(fs.readFileSync(path.join(d, e.name)))); } catch { /* vanished */ } }
    }
  };
  walk(dir, "");
  return out;
}

/** Copy the version's boards/ and system/ (regular files only — a symlink in the version is not copied, it could point out of it). */
function copyVersion(vdir, work) {
  for (const part of ["boards", "system"]) {
    const src = path.join(vdir, part);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(work, part), {
      recursive: true,
      filter: (p) => { const n = path.basename(p); if (n.startsWith(".") && p !== src) return false; if (n === "node_modules" || n.endsWith(".tmp")) return false; return !fs.lstatSync(p).isSymbolicLink(); },
    });
  }
}

function chownTree(dir, uid, gid) {
  const walk = (d) => {
    fs.chownSync(d, uid, gid);
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (!e.isSymbolicLink()) fs.chownSync(p, uid, gid);
    }
  };
  walk(dir);
}

const atomicWrite = (abs, buf) => {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, abs);
};

/**
 * What the script left in `work` → applied to the version. Returns { applied, deleted, rejected: [{ rel, reason }], conflicts }.
 * `baseline`: rel → hash of the version's files when the copy was made; a file the person changed since is a conflict.
 */
function landChanges({ vdir, work, baseline, lang }) {
  const links = [];
  const now = snapshot(work, { symlinks: links });
  const applied = [], deleted = [], rejected = [], conflicts = [];
  const versionHash = (rel) => { try { return hashOf(fs.readFileSync(path.join(vdir, rel))); } catch { return null; } };
  for (const rel of links) rejected.push({ rel, reason: "symlinks are not allowed" });
  const changed = [...now].filter(([rel, h]) => baseline.get(rel) !== h).map(([rel]) => rel);
  const removed = [...baseline.keys()].filter((rel) => !now.has(rel));
  if (changed.length + removed.length > MAX_CHANGED) return { applied, deleted, rejected: [{ rel: "*", reason: `more than ${MAX_CHANGED} files changed — nothing was applied` }], conflicts };
  for (const rel of changed) {
    if (!writableRel(rel)) { rejected.push({ rel, reason: "not an editable file type, or outside boards/ and system/" }); continue; }
    const abs = path.join(work, rel);
    let buf;
    try { buf = fs.readFileSync(abs); } catch { continue; }
    if (buf.length > MAX_FILE) { rejected.push({ rel, reason: `larger than ${MAX_FILE} bytes` }); continue; }
    const issue = contentIssue(rel, buf.toString("utf8"), { lang });
    if (issue) { rejected.push({ rel, reason: issue }); continue; }
    if (versionHash(rel) !== (baseline.get(rel) ?? null)) { conflicts.push(rel); continue; }
    atomicWrite(path.join(vdir, rel), buf);
    applied.push(rel);
  }
  for (const rel of removed) {
    if (!writableRel(rel)) { rejected.push({ rel, reason: "not an editable file type, or outside boards/ and system/" }); continue; }
    if (versionHash(rel) !== baseline.get(rel)) { conflicts.push(rel); continue; }
    try { fs.unlinkSync(path.join(vdir, rel)); deleted.push(rel); } catch { /* already gone */ }
  }
  return { applied: applied.sort(), deleted: deleted.sort(), rejected, conflicts };
}

/**
 * The sandbox of one project + version. backend: "process" | "bwrap" | "docker" (from detectBackend).
 * run({ command, timeoutMs, version }) → { code, signal, timedOut, stdout, stderr, truncated, applied, deleted, rejected, conflicts }.
 * `onStarted` (tests): called right after the command starts.
 */
export function createSandbox({ backend, root, version, timeoutMs = 120_000, maxOutput = 64_000, lang = "en", image = process.env.CRAFT_SANDBOX_IMAGE || "node:22-slim" }) {
  const isRoot = process.getuid?.() === 0;
  return {
    backend,
    // version: the version to work on (the one given to createSandbox when the sandbox belongs to one version).
    async run({ command, timeoutMs: limit = timeoutMs, onStarted, version: v = version } = {}) {
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(v))) throw new Error("the sandbox needs the version to work on");
      const vdir = path.join(root, "versions", v);
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX));
      try {
        fs.chmodSync(scratch, 0o755);
        const work = path.join(scratch, "work"), home = path.join(scratch, "home"), tmp = path.join(scratch, "tmp");
        for (const d of [work, home, tmp]) fs.mkdirSync(d);
        copyVersion(vdir, work);
        const baseline = snapshot(work);
        const drop = isRoot && backend !== "bwrap";
        if (drop) chownTree(scratch, NOBODY, NOBODY);
        const env = { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: home, TMPDIR: tmp, LANG: "C.UTF-8", TERM: "dumb" };
        const [cmd, args, opts] = backend === "bwrap" ? ["bwrap", buildBwrapArgs({ workDir: work, homeDir: home, command }), { env: { PATH: env.PATH } }]
          : backend === "docker" ? ["docker", buildDockerArgs({ workDir: work, image, command }), { env: { PATH: env.PATH, HOME: process.env.HOME ?? "/root" } }]
          : ["/bin/bash", ["-c", command], { cwd: work, env, ...(drop ? { uid: NOBODY, gid: NOBODY } : {}) }];
        const res = await new Promise((resolve) => {
          const out = { stdout: "", stderr: "", truncated: false };
          const child = spawn(cmd, args, { ...opts, detached: true, stdio: ["ignore", "pipe", "pipe"] });
          let timedOut = false, done = false;
          const killGroup = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } } };
          const timer = setTimeout(() => { timedOut = true; killGroup(); }, limit);
          const take = (key) => (d) => {
            if (out[key].length < maxOutput) out[key] += d.toString("utf8").slice(0, maxOutput - out[key].length);
            else out.truncated = true;
            if (out[key].length >= maxOutput) out.truncated = true;
          };
          child.stdout.on("data", take("stdout"));
          child.stderr.on("data", take("stderr"));
          const finish = (code, signal) => { if (done) return; done = true; clearTimeout(timer); killGroup(); resolve({ code, signal, timedOut, ...out }); };
          child.once("error", (e) => { out.stderr += `\n${e.message}`; finish(null, null); });
          child.once("close", (code, signal) => finish(code, signal));
          onStarted?.(child);
        });
        const landed = res.timedOut ? { applied: [], deleted: [], rejected: [], conflicts: [] } : landChanges({ vdir, work, baseline, lang });
        return { ...res, ...landed };
      } finally {
        if (path.basename(scratch).startsWith(SCRATCH_PREFIX)) fs.rmSync(scratch, { recursive: true, force: true });
      }
    },
  };
}
