// The sandbox for Claude's scripts. The `process` backend is run for real (a temp project, real child processes);
// bwrap / docker are tested as the argument lists they would run (no such tool is needed on this machine).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectBackend, buildBwrapArgs, buildDockerArgs, createSandbox } from "./sandbox.mjs";

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sbx-"));
  const v = path.join(root, "versions", "v1");
  fs.mkdirSync(path.join(v, "boards", "screens"), { recursive: true });
  fs.mkdirSync(path.join(v, "system"), { recursive: true });
  fs.writeFileSync(path.join(v, "version.json"), '{"id":"v1"}');
  fs.writeFileSync(path.join(v, "tsconfig.json"), "{}");
  fs.writeFileSync(path.join(v, "boards", "screens", "a.tsx"), "export default () => <p className=\"p-3\">a</p>;\n");
  fs.writeFileSync(path.join(v, "boards", "screens", "a.meta.json"), '{"title":"A"}');
  fs.writeFileSync(path.join(v, "system", "tokens.css"), ":root { --spacing: 4px; }\n");
  fs.writeFileSync(path.join(v, "boards", "pic.webp"), Buffer.from([1, 2, 3]));
  return { root, v, read: (rel) => fs.readFileSync(path.join(v, rel), "utf8") };
}
const mk = (p, over = {}) => createSandbox({ backend: "process", root: p.root, version: "v1", ...over });

test("detectBackend: off / process / explicit tools; auto picks bwrap only when it really works; never docker or process by itself", () => {
  const none = () => null;
  assert.deepEqual(detectBackend({ env: { CRAFT_SANDBOX: "off" }, which: () => "/x" }).backend, null);
  assert.equal(detectBackend({ env: { CRAFT_SANDBOX: "process" }, which: none }).backend, "process");
  assert.equal(detectBackend({ env: {}, which: none }).backend, null);
  const noBwrap = detectBackend({ env: {}, which: none });
  assert.match(noBwrap.reason, /bwrap/);
  assert.equal(detectBackend({ env: {}, which: (n) => (n === "bwrap" ? "/usr/bin/bwrap" : null), probe: () => true }).backend, "bwrap");
  assert.equal(detectBackend({ env: {}, which: (n) => (n === "bwrap" ? "/usr/bin/bwrap" : null), probe: () => false }).backend, null, "bwrap present but not allowed to run (no user namespaces)");
  assert.equal(detectBackend({ env: { CRAFT_SANDBOX: "docker" }, which: (n) => (n === "docker" ? "/usr/bin/docker" : null) }).backend, "docker");
  assert.equal(detectBackend({ env: { CRAFT_SANDBOX: "docker" }, which: none }).backend, null);
  assert.equal(detectBackend({ env: { CRAFT_SANDBOX: "nonsense" }, which: none }).backend, null);
});

test("buildBwrapArgs: no network, nothing of the host but the system, only the work folder writable", () => {
  const a = buildBwrapArgs({ workDir: "/tmp/s/work", homeDir: "/tmp/s/home", command: "echo hi" });
  assert.ok(a.includes("--unshare-all") && !a.includes("--share-net"));
  assert.ok(a.includes("--die-with-parent"));
  const bindIdx = a.indexOf("--bind");
  assert.deepEqual(a.slice(bindIdx, bindIdx + 3), ["--bind", "/tmp/s/work", "/work"]);
  assert.ok(a.join(" ").includes("--chdir /work"));
  assert.deepEqual(a.slice(-3), ["/bin/bash", "-c", "echo hi"]);
  assert.ok(!a.join(" ").includes("/root"), "no host home");
});

test("buildDockerArgs: no network, no extra privileges, limited memory/processes, only the work folder mounted", () => {
  const a = buildDockerArgs({ workDir: "/tmp/s/work", image: "node:22-slim", command: "ls", memory: "512m" });
  assert.deepEqual(a.slice(0, 2), ["run", "--rm"]);
  assert.ok(a.join(" ").includes("--network none"));
  assert.ok(a.join(" ").includes("--cap-drop ALL"));
  assert.ok(a.join(" ").includes("--security-opt no-new-privileges"));
  assert.ok(a.join(" ").includes("--memory 512m"));
  assert.ok(a.join(" ").includes("-v /tmp/s/work:/work"));
  assert.deepEqual(a.slice(-4), ["node:22-slim", "/bin/bash", "-c", "ls"]);
});

test("process: runs a command in a copy, returns its output, and lands a valid change in the version", async () => {
  const p = project();
  const sb = mk(p);
  const r = await sb.run({ command: "sed -i 's/p-3/p-2/' boards/screens/a.tsx && echo changed" });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /changed/);
  assert.deepEqual(r.applied, ["boards/screens/a.tsx"]);
  assert.match(p.read("boards/screens/a.tsx"), /p-2/);
  assert.equal(p.read("version.json"), '{"id":"v1"}', "version.json is never touched");
});

test("process: a script can create, modify and delete files; new editable files land, everything is atomic and reported", async () => {
  const p = project();
  const r = await mk(p).run({ command: "echo 'export const X = 1;' > boards/_k.ts && rm boards/screens/a.meta.json && echo '/* t */' >> system/tokens.css" });
  assert.deepEqual(r.applied.sort(), ["boards/_k.ts", "system/tokens.css"]);
  assert.deepEqual(r.deleted, ["boards/screens/a.meta.json"]);
  assert.equal(fs.existsSync(path.join(p.v, "boards", "screens", "a.meta.json")), false);
  assert.match(p.read("system/tokens.css"), /\/\* t \*\//);
});

test("process: what the sandbox must not change is refused and reported — other file types, symlinks, dangerous CSS, files outside boards/ and system/", async () => {
  const p = project();
  const r = await mk(p).run({ command: [
    "echo 'rm -rf /' > boards/run.sh",
    "ln -s /etc/hostname boards/screens/link.tsx",
    "echo '@plugin \"./x.js\";' > system/evil.css",
    "echo x >> boards/pic.webp",
    "echo x > ../outside.txt",
    "echo ok > boards/screens/fine.tsx",
  ].join("; ") });
  assert.deepEqual(r.applied, ["boards/screens/fine.tsx"]);
  const why = Object.fromEntries(r.rejected.map((x) => [x.rel, x.reason]));
  assert.ok(why["boards/run.sh"], "run.sh refused");
  assert.match(why["boards/screens/link.tsx"], /symlink/i);
  assert.match(why["system/evil.css"], /plugin/i);
  assert.ok(why["boards/pic.webp"], "binary file refused");
  for (const f of ["boards/run.sh", "boards/screens/link.tsx", "system/evil.css"]) assert.equal(fs.existsSync(path.join(p.v, f)), false, `${f} not created`);
  assert.deepEqual([...fs.readFileSync(path.join(p.v, "boards", "pic.webp"))], [1, 2, 3]);
});

test("process: a file changed in the version while the script ran is a conflict — the person's change wins, the script's is reported", async () => {
  const p = project();
  const r = await mk(p).run({ command: "echo script > boards/screens/a.tsx; sleep 0.4", onStarted: () => fs.writeFileSync(path.join(p.v, "boards", "screens", "a.tsx"), "person edit\n") });
  assert.deepEqual(r.applied, []);
  assert.deepEqual(r.conflicts, ["boards/screens/a.tsx"]);
  assert.equal(p.read("boards/screens/a.tsx"), "person edit\n");
});

test("process: the environment is scrubbed (no secrets), HOME is private, the project folder is not the working directory", async () => {
  const p = project();
  process.env.CRAFT_TEST_SECRET = "hunter2";
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "tok";
  try {
    const r = await mk(p).run({ command: "env; pwd" });
    assert.ok(!r.stdout.includes("hunter2") && !r.stdout.includes("CLAUDE_CODE_OAUTH_TOKEN"), "no secrets in the environment");
    assert.ok(!r.stdout.includes(p.root + "\n"), "cwd is a copy");
    assert.match(r.stdout, /PATH=/);
  } finally { delete process.env.CRAFT_TEST_SECRET; delete process.env.CLAUDE_CODE_OAUTH_TOKEN; }
});

test("process: a command that runs too long is killed with its children; output is capped; the scratch folder is removed", async () => {
  const p = project();
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("craft-sandbox-")).length;
  const t = Date.now();
  const r = await mk(p, { maxOutput: 2000 }).run({ command: "sleep 30 & sleep 30", timeoutMs: 500 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - t < 5000);
  const big = await mk(p, { maxOutput: 2000 }).run({ command: "yes abcdefghij | head -c 100000" });
  assert.equal(big.truncated, true);
  assert.ok(big.stdout.length <= 2200);
  const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("craft-sandbox-")).length;
  assert.equal(after, before, "scratch folders cleaned up");
});

test("process: a script of another kind (node) works the same way", async () => {
  const p = project();
  const r = await mk(p).run({ command: "node -e \"const fs=require('fs');const f='system/tokens.css';fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('4px','3px'))\"" });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.applied, ["system/tokens.css"]);
  assert.match(p.read("system/tokens.css"), /3px/);
});
