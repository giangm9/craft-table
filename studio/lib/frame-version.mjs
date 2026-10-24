// Version of a frame (frame-entry.tsx): ?v= when given, otherwise the LIVE version asked from the server
// (/__api/versions). When that fails → an error the frame shows plainly; a version is NEVER guessed. Pure: the caller
// passes fetch in. The error is worded in opts.lang ("en" | "vi", default "en": the viewer's language — the frame's
// data-ui-lang), texts in lib/i18n/data.mjs.
import { dataText } from "./i18n/data.mjs";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/; // the same rule as lib/versions.mjs (that file uses fs, the UI cannot load it)

/**
 * @param {string | null | undefined} param the frame's ?v= value
 * @param {(url: string) => Promise<Response>} fetchImpl
 * @param {{ lang?: string }} [opts]
 * @returns {Promise<{ version: string, error?: undefined } | { version?: undefined, error: string }>}
 */
export async function frameVersion(param, fetchImpl, opts = {}) {
  if (param) return { version: param };
  /** @param {string} key @param {Record<string, unknown>} [params] */
  const fail = (key, params) => ({ error: dataText(opts?.lang ?? "en", key, params) });
  let res;
  try { res = await fetchImpl("/__api/versions"); } catch (e) { return fail("frameUnreachable", { detail: String(/** @type {Error} */ (e)?.message ?? e) }); }
  const body = await res.text().catch(() => "");
  let data = null;
  try { data = JSON.parse(body); } catch { /* not JSON (e.g. an error page in plain text) */ }
  if (!res.ok) {
    // The detail ends the sentence: its own trailing full stop is dropped (the text adds one).
    const detail = String(typeof data?.error === "string" ? data.error : body).trim().slice(0, 300).replace(/[.\s]+$/, "");
    return fail("frameServerError", { status: res.status, detail });
  }
  if (!data || typeof data !== "object") return fail("frameUnreadable");
  return typeof data.live === "string" && ID_RE.test(data.live) ? { version: data.live } : fail("frameNoLive");
}
