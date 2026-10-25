// Design conversations: each board has several THREADS; each message can carry MARKS (regions) as reference
// points (scenario + frame + document px coordinates + the text inside the region).
// In a message's text, "[#n]" points to mark n OF THAT MESSAGE; the UI shows the numbers running through the whole
// thread (allRefs). Claude places marks with the @khoanh(...) / @mark(...) syntax.
// This file is PURE (no Node modules) so the studio UI shares it; the IO is in threads.mjs.
// Words (texts in lib/i18n/data.mjs) follow the `lang` the caller passes ("en" | "vi", default "en"):
//   • errors of newThread / addMessage / editRef → { ok: false, code, params, error }: `error` in `lang` (the
//     viewer's, at the API); code + params let a caller word it in another language;
//   • transcript (what Claude reads) → the project's language.
import { isValidEntryId } from "./entries.mjs";
import { dataText } from "./i18n/data.mjs";

const VIEWPORTS = new Set(["desktop", "mobile"]);
// Version (versions/<id>) — the same rule as studio/lib/versions.mjs (that file uses fs, it cannot be shared).
const VERSION_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
/**
 * A thread written before versions existed belongs to the LIVE version `live` (the IO layer reads it from the
 * project's versions/ when loading). No version known (live empty) → kept as it is.
 */
export const normalizeThread = (t, live) => (t && !t.version && live ? { ...t, version: live } : t);
const ROLES = new Set(["user", "claude"]);
const SCENARIO_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const MAX_TEXT = 8000;
const MAX_REFS = 12;
const MAX_IMAGES = 6;
const UPLOAD_RE = /^[a-f0-9]{16}\.(png|jpg|webp|gif)$/; // id of an attached image (studio/lib/uploads.mjs)
const isNum = (n) => typeof n === "number" && Number.isFinite(n);

/** A refused input → { ok: false, code, params, error } (`error` worded in `lang`). */
const fail = (lang, code, params = {}) => ({ ok: false, code, params, error: dataText(lang, code, params) });

/**
 * The main screen of an id (option "<screen>~<name>" → "<screen>"). A main screen + its options = one CLUSTER: they
 * share threads; a message records `viewing` (the screen its sender was looking at), a mark records `entry` (the
 * screen it was drawn on) when it differs from the thread's screen.
 */
export const featureOf = (id) => String(id ?? "").split("~")[0];
/**
 * A WHOLE-DESIGN thread belongs to a version, not to a screen: its `entry` is this marker (never a valid screen id).
 * The person's messages say which screen they were looking at (`viewing`); a mark names its own screen (`entry`).
 */
export const DESIGN_ENTRY = "*";
export const isDesignThread = (t) => t?.entry === DESIGN_ENTRY;

// A screen is named inside a message as @[screen-id] (the composer's "@" menu writes it; the UI shows it as a link to the
// screen; Claude reads the ids from the prompt and may write the same in its replies).
const MENTION = /@\[([a-z0-9][a-z0-9/_~-]*)\]/g;
/**
 * A text → pieces in order: text, or a mention of a screen; an @[…] that is not a valid screen id stays text.
 * @param {unknown} text
 * @returns {({ type: "text", value: string } | { type: "mention", id: string })[]}
 */
export function splitMentions(text) {
  const s = String(text ?? "");
  const out = [];
  let last = 0;
  for (const m of s.matchAll(MENTION)) {
    if (!isValidEntryId(m[1])) continue;
    if (m.index > last) out.push({ type: "text", value: s.slice(last, m.index) });
    out.push({ type: "mention", id: m[1] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ type: "text", value: s.slice(last) });
  return out;
}
/** A text with every mention written as the screen's short name (last part of its id, "~" → " ") — for a title. */
export const plainMentions = (text) => splitMentions(text).map((p) => (p.type === "mention" ? p.id.split("/").pop().replace(/~/g, " ") : p.value)).join("");
/** The screens a text mentions, each once, in order of appearance. */
export const mentionsOf = (text) => [...new Set(splitMentions(text).filter((p) => p.type === "mention").map((p) => p.id))];
/** Threads of the whole cluster holding `entry`, in one version. */
export const threadsOfFeature = (threads, entry, version) => threads.filter((t) => t.version === version && featureOf(t.entry) === featureOf(entry));
const inFeature = (id, base) => isValidEntryId(id) && featureOf(id) === featureOf(base);

function cleanRef(r, base) {
  const x = r ?? {};
  if (x.scenario != null && !(typeof x.scenario === "string" && SCENARIO_RE.test(x.scenario))) return null;
  if (!VIEWPORTS.has(x.viewport)) return null;
  const q = x.rect ?? {};
  if (![q.x, q.y, q.w, q.h].every(isNum) || q.x < 0 || q.y < 0 || q.w <= 0 || q.h <= 0) return null;
  if (base === DESIGN_ENTRY) { if (!isValidEntryId(x.entry)) return null; } // a design thread's mark names its own screen
  else if (x.entry != null && !(base ? inFeature(x.entry, base) : isValidEntryId(x.entry))) return null;
  const texts = Array.isArray(x.texts) ? x.texts.filter((t) => typeof t === "string").slice(0, 30) : [];
  return {
    scenario: x.scenario ?? null,
    viewport: x.viewport,
    rect: { x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.w), h: Math.round(q.h) },
    texts,
    ...(x.entry != null && x.entry !== base ? { entry: x.entry } : {}),
  };
}

/** opts: { id, now, lang? } — lang words a refusal (default "en"). */
export function newThread(input, { id, now, lang }) {
  const i = input ?? {};
  if (i.entry !== DESIGN_ENTRY && !isValidEntryId(i.entry)) return fail(lang, "threadEntryInvalid");
  if (typeof i.version !== "string" || !VERSION_RE.test(i.version)) return fail(lang, "threadVersionInvalid");
  const title = typeof i.title === "string" ? i.title.trim().slice(0, 120) : "";
  if (!title) return fail(lang, "threadTitleMissing");
  return {
    ok: true,
    thread: { id, entry: i.entry, version: i.version, title, createdBy: String(i.author ?? ""), createdAt: now, updatedAt: now, status: "open", messages: [], agent: { state: "idle" } },
  };
}

/** opts: { id, now, lang? } — lang words a refusal (default "en"). */
export function addMessage(thread, input, { id, now, lang }) {
  const i = input ?? {};
  if (!ROLES.has(i.role)) return fail(lang, "messageRoleInvalid");
  const text = typeof i.text === "string" ? i.text.trim() : "";
  if (text.length > MAX_TEXT) return fail(lang, "messageTooLong");
  const raw = Array.isArray(i.refs) ? i.refs : [];
  if (raw.length > MAX_REFS) return fail(lang, "messageTooManyMarks");
  const refs = raw.map((r) => cleanRef(r, thread.entry));
  if (refs.some((r) => !r)) return fail(lang, "markInvalid");
  const viewing = i.viewing != null && i.viewing !== thread.entry ? i.viewing : null;
  if (viewing && !(isDesignThread(thread) ? isValidEntryId(viewing) : inFeature(viewing, thread.entry))) return fail(lang, "messageViewingOutside");
  const images = Array.isArray(i.images) ? i.images : [];
  if (images.length > MAX_IMAGES) return fail(lang, "messageTooManyImages", { max: MAX_IMAGES });
  if (images.some((x) => typeof x !== "string" || !UPLOAD_RE.test(x))) return fail(lang, "messageImageInvalid");
  if (!text && !refs.length && !images.length) return fail(lang, "messageEmpty");
  const msg = { id, role: i.role, author: String(i.author ?? ""), at: now, text, refs, images: [...new Set(images)], ...(viewing ? { viewing } : {}) };
  return { ok: true, thread: { ...thread, messages: [...thread.messages, msg], updatedAt: now } };
}

export function setAgent(thread, patch, now) {
  return { ...thread, agent: { ...thread.agent, ...patch }, updatedAt: now ?? thread.updatedAt };
}

// @khoanh(<scenario|->, <desktop|mobile>, x, y, w, h) — @mark(...) is an equal alias: which name Claude
// is told to write follows the project language; both are always read.
const MARK_CALL = /@(?:khoanh|mark)\(\s*([a-z0-9-]+)\s*,\s*(desktop|mobile|[a-z]+)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g;

/**
 * The agent's reply → text (marks replaced by [#n]) + the list of valid marks.
 * opts.marks === false: there is no screen to put marks on (a design turn nobody looked at a screen for) → the calls are removed.
 */
export function parseAgentReply(raw, { marks = true } = {}) {
  if (!marks) return { text: String(raw ?? "").replace(MARK_CALL, "").replace(/[ \t]{2,}/g, " ").trim(), refs: [] };
  const refs = [];
  const text = String(raw ?? "").replace(MARK_CALL, (whole, sc, vp, x, y, w, h) => {
    const r = cleanRef({ scenario: sc === "-" ? null : sc, viewport: vp, rect: { x: +x, y: +y, w: +w, h: +h } });
    if (!r || refs.length >= MAX_REFS) return whole;
    refs.push(r);
    return `[#${refs.length}]`;
  });
  return { text: text.trim(), refs };
}

/**
 * Edit a mark ALREADY SENT (by a person or Claude). action: "remove" (keeps its place, records `removed` so [#k]
 * in the text and the #n of the other marks do not change), "restore", "redraw" (replace the region with `ref`,
 * keep the number, record `redrawn`). opts: { by, now, lang? } — lang words a refusal (default "en").
 */
export function editRef(thread, { messageId, index, action, ref } = {}, { by, now, lang }) {
  const mi = thread.messages.findIndex((m) => m.id === messageId);
  const cur = thread.messages[mi]?.refs?.[index];
  if (!cur) return fail(lang, "markMissing");
  let next;
  if (action === "remove") {
    if (cur.removed) return fail(lang, "markAlreadyRemoved");
    next = { ...cur, removed: { by: String(by ?? ""), at: now } };
  } else if (action === "restore") {
    if (!cur.removed) return fail(lang, "markNotRemoved");
    const { removed: _, ...rest } = cur;
    next = rest;
  } else if (action === "redraw") {
    if (cur.removed) return fail(lang, "markRemovedRestoreFirst");
    const r = cleanRef(ref, thread.entry);
    if (!r) return fail(lang, "markInvalid");
    next = { ...r, redrawn: { by: String(by ?? ""), at: now } };
  } else return fail(lang, "markActionInvalid");
  const messages = thread.messages.map((m, i) => (i === mi ? { ...m, refs: m.refs.map((x, k) => (k === index ? next : x)) } : m));
  return { ok: true, thread: { ...thread, messages, updatedAt: now } };
}

/** Earlier marks removed / redrawn AFTER `since` (ISO) → [{ n, change }] — told to Claude on its next turn. */
export function refChangesSince(thread, since) {
  const out = [];
  for (const r of allRefs(thread)) {
    if (r.removed?.at > since) out.push({ n: r.n, change: "removed" });
    else if (!r.removed && r.redrawn?.at > since) out.push({ n: r.n, change: "redrawn" });
  }
  return out;
}

/** Drop mark k while composing: delete "[#k]" in the text, a later [#j] becomes [#j-1] — the text still points at the right region. */
export function dropMark(text, k) {
  return String(text ?? "").replace(/\[#(\d+)\]( ?)/g, (s, j, sp) => (+j === k ? "" : +j > k ? `[#${j - 1}]${sp}` : s));
}

/** Every mark in the thread, numbered from 1 in message order. */
export function allRefs(thread) {
  const out = [];
  for (const m of thread.messages) m.refs.forEach((ref, index) => out.push({ ...ref, messageId: m.id, role: m.role, index, n: out.length + 1 }));
  return out;
}
export const refLabel = (thread, messageId, index) => allRefs(thread).find((r) => r.messageId === messageId && r.index === index)?.n ?? 0;

/** A message's text with [#k] (mark k OF THE MESSAGE) turned into the thread's number [#n] — matches the board's labels and view_region(n). */
export function textWithThreadMarks(thread, m, refs = allRefs(thread)) {
  const mine = refs.filter((r) => r.messageId === m.id);
  return String(m.text ?? "").replace(/\[#(\d+)\]/g, (s, k) => { const r = mine[Number(k) - 1]; return r ? `[#${r.n}]` : s; });
}

/** Claude spoke last (a question / a proposal) and is idle → waiting for the person to answer. */
export function waitingForUser(t) {
  const last = t.messages[t.messages.length - 1];
  return t.status === "open" && t.agent?.state !== "running" && !!last && last.role === "claude";
}

/** The person's messages after Claude's last reply — what the agent has to handle. */
export function pendingUserMessages(t) {
  const out = [];
  for (let i = t.messages.length - 1; i >= 0 && t.messages[i].role === "user"; i--) out.unshift(t.messages[i]);
  return out;
}

const describeRef = (r, n, lang) => `  ${r.removed ? dataText(lang, "transcriptMarkRemoved", { n }) : dataText(lang, "transcriptMark", {
  n, scenario: r.scenario ?? null, viewport: r.viewport, x: r.rect.x, y: r.rect.y, w: r.rect.w, h: r.rect.h,
  texts: r.texts?.length ? r.texts.slice(0, 8).map((t) => JSON.stringify(t)).join(", ") : "",
})}`;

/**
 * The messages written out for the agent to read (a message's marks use its own [#n]).
 * opts.uploadsDir: folder of the attached images (absolute path) — written into the prompt so Claude can Read them.
 * opts.lang: "en" | "vi" (default "en") — the project's language (Claude reads this).
 */
export function transcript(thread, messages, opts = {}) {
  const { lang, uploadsDir } = opts ?? {};
  return messages.map((m) => {
    const who = m.role === "claude" ? dataText(lang, "transcriptClaude") : m.author;
    const refs = m.refs.map((r, i) => describeRef(r, i + 1, lang)).join("\n");
    const imgs = (m.images ?? []).map((x, i) => `  ${dataText(lang, "transcriptImage", { n: i + 1, path: uploadsDir ? `${uploadsDir}/${x}` : x })}`).join("\n");
    const body = m.text || dataText(lang, imgs && !refs ? "transcriptOnlyImages" : "transcriptOnlyMarks");
    return `${who}:\n${body}${refs ? `\n${dataText(lang, "transcriptMarks")}\n${refs}` : ""}${imgs ? `\n${dataText(lang, "transcriptImages")}\n${imgs}` : ""}`;
  }).join("\n\n");
}
