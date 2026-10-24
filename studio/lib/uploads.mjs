// Images people attach to a message (the composer of a conversation thread). Stored in <project>/data/uploads/
// (gitignored, not watched by Vite); the name is 16 characters of the content hash + an extension from the REAL type
// read from the first bytes (the file name and Content-Type are not trusted) — PNG, JPEG, WebP and GIF only (no SVG:
// it can run scripts). The studio's Claude Reads an image through the path written in its prompt (thread-core
// transcript).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StudioError } from "./i18n.mjs";

export const MAX_UPLOAD = 10 * 1024 * 1024;
const ID_RE = /^[a-f0-9]{16}\.(png|jpg|webp|gif)$/;
export const isUploadId = (s) => typeof s === "string" && ID_RE.test(s);
export const UPLOAD_MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

function sniff(b) {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1"))) return "gif";
  return null;
}

/** Image larger than `limit` bytes: a StudioError the server words in the viewer's language (lib/i18n/server.mjs). */
export const tooLarge = (limit = MAX_UPLOAD) => new StudioError("uploadTooLarge", { mb: limit / 1024 / 1024 });

/** Save an image → its id ("<hash16>.<ext>"). The same content → the same id (never stored twice). */
export function saveUpload(dir, buf) {
  if (buf.length > MAX_UPLOAD) throw tooLarge();
  const ext = sniff(buf);
  if (!ext) throw new StudioError("uploadNotImage");
  const id = `${crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16)}.${ext}`;
  const abs = path.join(dir, id);
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, abs);
  }
  return id;
}

/** File path of a valid id; any other id → null. */
export const uploadFile = (dir, id) => (isUploadId(id) ? path.join(dir, id) : null);
