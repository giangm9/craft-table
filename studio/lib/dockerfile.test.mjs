// The Dockerfile: the usage its header documents must give a studio people can open, and the image must not
// leave root-owned files in the mounted project or carry a browser it never uses. The real image is checked by
// building and running it; these checks keep the file from drifting back.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DOCKERFILE = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
const SERVER = fs.readFileSync(path.join(ROOT, "studio", "server.mjs"), "utf8");
const SHOTS = fs.readFileSync(path.join(ROOT, "studio", "lib", "shots.mjs"), "utf8");

/** Shell commands shown in the header comment (lines before FROM), continuation lines joined. */
function documentedCommands() {
  const header = DOCKERFILE.slice(0, DOCKERFILE.search(/^FROM /m)).split("\n").map((l) => l.replace(/^#\s?/, ""));
  return header.join("\n").replace(/\\\n\s*/g, " ").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("docker "));
}

/** Instructions (continuation lines joined, comments dropped) as { op, args }. */
function instructions() {
  const body = DOCKERFILE.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n").replace(/\\\n/g, " ");
  return body.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [op, ...rest] = l.split(/\s+/);
    return { op: op.toUpperCase(), args: rest.join(" ") };
  });
}

const runs = () => documentedCommands().filter((c) => c.startsWith("docker run "));

test("every documented `docker run` gives a studio that opens", () => {
  // Without sign-in the server answers only requests from its own machine (session.mjs isLocalRequest): through
  // -p every request arrives from Docker's network, so such a run answers 503 to every page.
  assert.ok(runs().length > 0, "the header documents how to run the image");
  for (const cmd of runs()) {
    if (/\s(-p|--publish)[\s=]/.test(cmd)) {
      for (const name of ["IDP_ISSUER", "OIDC_CLIENT_SECRET", "SESSION_SECRET"]) {
        assert.match(cmd, new RegExp(`-e ${name}=|--env-file`), `published port without sign-in (${name}): ${cmd}`);
      }
    } else {
      assert.match(cmd, /--network[ =]host\b/, `neither sign-in nor the machine's own network: ${cmd}`);
    }
  }
});

test("the sign-in settings the header names are the ones the server reads", () => {
  const named = new Set(DOCKERFILE.slice(0, DOCKERFILE.search(/^FROM /m)).match(/\b(IDP_ISSUER|OIDC_[A-Z_]+|SESSION_SECRET|STUDIO_[A-Z_]+|ALLOWED_EMAILS)\b/g) ?? []);
  assert.ok(named.has("STUDIO_PUBLIC_URL"), "the header says where the studio is opened from");
  for (const name of named) assert.ok(SERVER.includes(`process.env.${name}`), `server.mjs does not read ${name}`);
});

test("the healthcheck follows STUDIO_PORT (on the host network the port may have to change)", () => {
  const hc = instructions().find((i) => i.op === "HEALTHCHECK");
  assert.ok(hc, "has a HEALTHCHECK");
  assert.match(hc.args, /STUDIO_PORT/);
  assert.match(hc.args, /__api\/project/);
});

test("runs as a non-root user; documented runs map it to the host user", () => {
  const users = instructions().filter((i) => i.op === "USER");
  const user = users.at(-1)?.args;
  assert.ok(user, "has a USER instruction");
  assert.doesNotMatch(user, /^(root|0)(:|$)/, `USER ${user}`);
  // A fresh named volume mounted at /project takes the ownership of the image's /project.
  const name = user.split(":")[0];
  assert.ok(instructions().some((i) => i.op === "RUN" && /\bmkdir\b[^&;]*\/project\b/.test(i.args) && new RegExp(`\\bchown\\b[^&;]*\\b${name}\\b[^&;]*/project\\b`).test(i.args)),
    `/project is created and owned by ${name}`);
  for (const cmd of runs()) assert.match(cmd, /--user "\$\(id -u\):\$\(id -g\)"/, `files written in the project would not be the host user's: ${cmd}`);
});

test("one browser in the image: npm ci skips puppeteer's download, full Chrome is installed explicitly", () => {
  const run = instructions().filter((i) => i.op === "RUN");
  const ci = run.find((i) => /\bnpm ci\b/.test(i.args));
  assert.ok(ci, "installs with npm ci");
  assert.match(ci.args, /PUPPETEER_SKIP_DOWNLOAD=(1|true)\s+npm ci\b/, "npm ci would download chrome + chrome-headless-shell");
  assert.ok(run.some((i) => /\bpuppeteer browsers install chrome\b(?!-)/.test(i.args)), "installs Chrome explicitly");
  assert.ok(!run.some((i) => /chrome-headless-shell/.test(i.args)), "no headless shell");
  assert.ok(!instructions().some((i) => i.op === "ENV" && /PUPPETEER_SKIP_DOWNLOAD/.test(i.args)), "the skip is for npm ci only, not the image");
  // headless: true runs full Chrome; headless: "shell" would need the browser this image leaves out.
  assert.match(SHOTS, /headless: true\b/);
  assert.doesNotMatch(SHOTS, /headless: ["']shell["']/);
});
