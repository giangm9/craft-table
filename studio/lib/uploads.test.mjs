import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveUpload, uploadFile, isUploadId, MAX_UPLOAD } from "./uploads.mjs";
import { addMessage, newThread, transcript } from "./thread-core.mjs";
import { StudioError, errorText } from "./i18n.mjs";
import SERVER_TEXT from "./i18n/server.mjs";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rest-of-png")]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("jpeg")]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBPVP8 ")]);
const GIF = Buffer.from("GIF89a....");

test("saveUpload: detects images by their first bytes (the declared name/type is not trusted), name = hash + extension, same content → same name", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "up-"));
  const a = saveUpload(dir, PNG);
  assert.match(a, /^[a-f0-9]{16}\.png$/);
  assert.deepEqual(fs.readFileSync(path.join(dir, a)), PNG);
  assert.equal(saveUpload(dir, PNG), a);
  assert.match(saveUpload(dir, JPG), /\.jpg$/);
  assert.match(saveUpload(dir, WEBP), /\.webp$/);
  assert.match(saveUpload(dir, GIF), /\.gif$/);
});

test("saveUpload rejects: not an image (svg, html, empty), too large — a StudioError the server words in the viewer's language", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "up-"));
  const notImage = (e) => e instanceof StudioError && e.code === "uploadNotImage";
  assert.throws(() => saveUpload(dir, Buffer.from("<svg onload=alert(1)>")), notImage);
  assert.throws(() => saveUpload(dir, Buffer.from("<html>")), notImage);
  assert.throws(() => saveUpload(dir, Buffer.alloc(0)), notImage);
  let big = null;
  try { saveUpload(dir, Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD)])); } catch (e) { big = e; }
  assert.ok(big instanceof StudioError && big.code === "uploadTooLarge", String(big));
  assert.deepEqual(big.params, { mb: 10 });
  assert.equal(errorText(big, "vi", SERVER_TEXT), "ảnh quá lớn (tối đa 10MB)");
  assert.equal(errorText(big, "en", SERVER_TEXT), "Image too large (max 10 MB)");
  assert.equal(errorText(new StudioError("uploadNotImage"), "vi", SERVER_TEXT), "không phải ảnh PNG / JPEG / WebP / GIF");
  assert.equal(errorText(new StudioError("uploadNotImage"), "en", SERVER_TEXT), "Not a PNG, JPEG, WebP or GIF image");
});

test("uploadFile / isUploadId: only well-formed ids, no climbing out of the folder", () => {
  assert.equal(isUploadId("0123456789abcdef.png"), true);
  for (const bad of ["../x.png", "0123456789abcdef.svg", "0123456789ABCDEF.png", "0123456789abcdef.png/..", "x.png", ""]) assert.equal(isUploadId(bad), false, bad);
  assert.equal(uploadFile("/d", "../../etc/passwd"), null);
  assert.equal(uploadFile("/d", "0123456789abcdef.jpg"), path.join("/d", "0123456789abcdef.jpg"));
});

test("messages with images: images alone can be sent; unknown id / more than 6 images → error; the prompt for Claude gives the image paths to Read", () => {
  const t = newThread({ entry: "screens/a", version: "ban-1", title: "T", author: "u" }, { id: "t_1", now: "n" }).thread;
  const ok = addMessage(t, { role: "user", author: "u", text: "", refs: [], images: ["0123456789abcdef.png"] }, { id: "m_1", now: "n" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.thread.messages[0].images, ["0123456789abcdef.png"]);
  assert.equal(addMessage(t, { role: "user", text: "x", images: ["../x.png"] }, { id: "m", now: "n" }).ok, false);
  assert.equal(addMessage(t, { role: "user", text: "x", images: Array.from({ length: 7 }, (_, i) => `${String(i).repeat(16)}.png`) }, { id: "m", now: "n" }).ok, false);
  const plain = addMessage(t, { role: "user", text: "x" }, { id: "m", now: "n" }).thread.messages[0];
  assert.deepEqual(plain.images, []);
  const tx = transcript(ok.thread, ok.thread.messages, { uploadsDir: "/srv/project/data/uploads" });
  assert.match(tx, /\/srv\/project\/data\/uploads\/0123456789abcdef\.png/);
  assert.match(tx, /Read/);
});
