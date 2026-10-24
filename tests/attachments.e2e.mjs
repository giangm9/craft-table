// e2e: images attached to a message.
//   • a new thread: picking an image uploads it at once and shows a thumbnail
//   • Send → the message shows the image; the file is in the project's data/uploads; the studio serves it as
//     image/png; the thread keeps the image's id
//   • something that is not an image (an SVG with a script) is refused
// The message is sent from the page with the studio's noAgent switch on. The thread and the uploaded file are
// removed at the end. Screenshots: tests/shots/attach-*.png
import fs from "node:fs";
import { DESKTOP, SHOTS, STUDIO, UI, api, gotoReady, newPage, ok, projectFile, run, shot, studioUrl } from "./lib/e2e.mjs";

const ENTRY = "screens/tasks/list";
const TEXT = "Attachment test: like this picture";

await run("attachments", async ({ browser, cleanup }) => {
  let upId = null;
  cleanup("thread and uploaded file", async () => {
    for (const t of (await api("GET", `/__api/threads?entry=${encodeURIComponent(ENTRY)}`)).threads) {
      if (t.messages[0]?.text.includes(TEXT)) await api("DELETE", `/__api/threads/${t.id}`);
    }
    if (upId) fs.rmSync(projectFile("data", "uploads", upId), { force: true });
  });

  const page = await newPage(browser, DESKTOP);
  await gotoReady(page, studioUrl({ e: ENTRY }));
  const png = `${SHOTS}attach-source.png`;
  await page.screenshot({ path: png, clip: { x: 0, y: 0, width: 120, height: 80 } });
  await gotoReady(page, studioUrl({ e: ENTRY, t: "new" }));
  await page.waitForSelector("[data-panel] [data-composer] textarea", { timeout: 10_000 });

  const input = await page.$("[data-panel] [data-image-input]");
  await input.uploadFile(png);
  upId = await page.waitForFunction(() => {
    const v = document.querySelector("[data-panel] [data-attachment]")?.getAttribute("data-attachment");
    return v && v !== "dang-tai" ? v : null; // "dang-tai" = still uploading
  }, { timeout: 15_000, polling: 150 }).then((h) => h.jsonValue(), () => null);
  ok(/^[a-f0-9]{16}\.png$/.test(upId ?? ""), `picking an image uploads it at once, with a thumbnail (${upId})`);
  await shot(page, "attach-1280-picked");

  await page.type("[data-panel] [data-composer] textarea", TEXT);
  await page.evaluate((label) => [...document.querySelectorAll("[data-panel] [data-composer] button")].find((b) => b.textContent.trim() === label)?.click(), UI.send);
  const shown = await page.waitForFunction((id) => document.querySelector(`[data-panel] [data-message-image='${id}'] img`)?.complete, { timeout: 15_000, polling: 150 }, upId).then(() => true, () => false);
  const tid = await page.evaluate(() => new URLSearchParams(location.search).get("t"));
  const msg = tid && tid !== "new" ? (await api("GET", `/__api/threads/${tid}`)).thread?.messages?.[0] : null;
  const type = await fetch(`${STUDIO}/__api/uploads/${upId}`).then((r) => r.headers.get("content-type"));
  ok(shown, "Send → the message shows the image");
  ok(fs.existsSync(projectFile("data", "uploads", upId)), "the file is in the project's data/uploads");
  ok(type === "image/png", `the studio serves it as ${type}`);
  ok(!!msg?.images?.includes(upId), `the thread keeps the image's id (${JSON.stringify(msg?.images)})`);
  await shot(page, "attach-1280-sent");

  const bad = await fetch(`${STUDIO}/__api/uploads`, { method: "POST", headers: { "Content-Type": "image/svg+xml" }, body: "<svg onload=alert(1)>" }).then((r) => r.status);
  ok(bad === 400, `an SVG with a script is refused (${bad})`);
  await page.close();
});
