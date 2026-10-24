// Calls to the studio server's API (studio/server.mjs, threads-api.mjs). Data types match studio/lib/threads.mjs.
// Error texts come from the server, already in the viewer's language (StudioError, lib/i18n.mjs).
import type { StoredText } from "./i18n/agent-status";

export type Viewport = "desktop" | "mobile";
export type Theme = "light" | "dark";
export type Rect = { x: number; y: number; w: number; h: number };

export type Scenario = { id: string; title: string; desc?: string };
export type EntryMeta = {
  title: string;
  /** The scenarios of a feature: each scenario is one row of frames on the canvas. */
  scenarios?: Scenario[];
  section?: string;
  group?: string;
  order?: number;
  desc?: string;
  viewports?: Viewport[];
  minHeight?: number;
  status?: string;
  /** Set = this screen is an OPTION of screen `of` (id "<screen>~<name>"). Status: a code (the server normalizes old words). */
  option?: { of: string; name: string; status: "trying" | "adopted"; createdBy?: string; createdAt?: string; adoptedBy?: string; adoptedAt?: string };
};
/** changed: the screen differs from the version's source version (the "changed" dot in the board list). */
export type Entry = { id: string; meta: EntryMeta; changed?: boolean };

/** Neutral codes, as studio/lib/versions.mjs VERSION_STATUSES (labels: i18n/values.ts versionStatusLabel). */
export const VERSION_STATUSES = ["draft", "approved", "live", "archived"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];
export type Version = { id: string; title: string; status: VersionStatus; from: string | null; createdAt: string; createdBy: string; note: string; live: boolean };

/** entry: the screen the mark was drawn on, when not the thread's screen (an option of the same group). */
/** removed / redrawn: a SENT mark that was removed (kept in place so the #n numbers do not shift) / redrawn — who, when. */
export type Ref = { scenario: string | null; viewport: Viewport; rect: Rect; texts: string[]; entry?: string; removed?: { by: string; at: string }; redrawn?: { by: string; at: string } };
/** images: ids of attached images (data/uploads/, served at /__api/uploads/<id>); older messages lack this field. */
/** viewing: the screen the sender was viewing, when not the thread's screen (an option of the same group). */
export type Message = { id: string; role: "user" | "claude"; author: string; at: string; text: string; refs: Ref[]; images?: string[]; viewing?: string };
export type AgentState = {
  state: "idle" | "queued" | "running" | "error";
  /** { key, params } written by the studio, or free text — show with agentText (i18n/agent-status.ts). */
  progress?: StoredText | null;
  error?: StoredText | null;
  startedAt?: string;
  finishedAt?: string;
  lastCostUsd?: number | null;
  sessionId?: string | null;
};
export type Thread = {
  id: string;
  entry: string;
  version: string;
  title: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  status: "open" | "closed";
  messages: Message[];
  agent: AgentState;
};

export const VIEWPORT_WIDTH: Record<Viewport, number> = { desktop: 1280, mobile: 390 };
export const viewportsOf = (e: Entry): Viewport[] => e.meta.viewports ?? ["desktop", "mobile"];
/** Scenarios to draw; a board with no scenarios → a single row (id null). */
export const scenariosOf = (e: Entry): Array<{ id: string | null; title?: string; desc?: string }> =>
  e.meta.scenarios?.length ? e.meta.scenarios : [{ id: null }];
/** The scenario row a mark belongs to (no scenario recorded → the first row). */
export const refScenario = (r: { scenario: string | null }, e: Entry): string | null => r.scenario ?? scenariosOf(e)[0].id;

// e2e tests set localStorage "studio:noAgent"="1" → creating a thread / sending a message does NOT run the real
// Claude (the server honours this flag only from 127.0.0.1).
const noAgent = () => { try { return localStorage.getItem("studio:noAgent") === "1"; } catch { return false; } };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  if (method === "POST" && body && typeof body === "object" && noAgent()) body = { ...(body as object), noAgent: true };
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

/** Upload an image (raw bytes) → its id. */
async function upload(file: Blob): Promise<string> {
  const res = await fetch("/__api/uploads", { method: "POST", headers: { "Content-Type": file.type && file.type.startsWith("image/") ? file.type : "image/png" }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return (data as { id: string }).id;
}
export const uploadUrl = (id: string) => `/__api/uploads/${id}`;

/** craft-table.json of the project being served (what the UI needs of it). */
/** source: the project's app repo — label + which folders / file types may be opened (never its path on disk). */
export type Project = { name: string; description: string; language: "en" | "vi"; logo: string | null; source: { label: string; roots: string[]; extensions: string[] } | null };

export const api = {
  upload,
  me: () => call<{ email: string }>("GET", "/__api/me"),
  project: () => call<Project>("GET", "/__api/project"),
  entries: (v?: string) => call<{ entries: Entry[] }>("GET", `/__api/entries${v ? `?v=${encodeURIComponent(v)}` : ""}`).then((r) => r.entries),
  versions: () => call<{ versions: Version[]; live: string }>("GET", "/__api/versions"),
  createVersion: (b: { from: string; title: string; note?: string }) => call<{ version: Version }>("POST", "/__api/versions", b).then((r) => r.version),
  patchVersion: (id: string, b: { title?: string; status?: VersionStatus; note?: string }) => call<{ version: Version }>("PATCH", `/__api/versions/${id}`, b).then((r) => r.version),
  setLive: (id: string) => call<{ live: string }>("POST", `/__api/versions/${id}/live`, {}),
  createOption: (b: { v: string; entries: string[]; name: string }) => call<{ ids: string[] }>("POST", "/__api/options", b).then((r) => r.ids),
  adoptOption: (b: { v: string; entry: string }) => call<{ written: string[] }>("POST", "/__api/options/adopt", b),
  removeOption: (b: { v: string; entry: string }) => call<{ removed: string[] }>("POST", "/__api/options/remove", b),
  renameOption: (b: { v: string; entry: string; name: string }) => call<{ renamed: string[] }>("POST", "/__api/options/rename", b),
  allThreads: () => call<{ threads: Thread[] }>("GET", "/__api/threads").then((r) => r.threads),
  threads: (entry: string) => call<{ threads: Thread[] }>("GET", `/__api/threads?entry=${encodeURIComponent(entry)}`).then((r) => r.threads),
  createThread: (b: { entry: string; version: string; text: string; refs: Ref[]; images?: string[]; title?: string }) => call<{ thread: Thread }>("POST", "/__api/threads", b).then((r) => r.thread),
  send: (id: string, b: { text: string; refs: Ref[]; images?: string[]; viewing?: string }) => call<{ thread: Thread }>("POST", `/__api/threads/${id}/messages`, b).then((r) => r.thread),
  editRef: (id: string, b: { messageId: string; index: number; action: "remove" | "restore" | "redraw"; ref?: Ref }) => call<{ thread: Thread }>("PATCH", `/__api/threads/${id}/refs`, b).then((r) => r.thread),
  patchThread: (id: string, b: { title?: string; status?: Thread["status"] }) => call<{ thread: Thread }>("PATCH", `/__api/threads/${id}`, b).then((r) => r.thread),
  deleteThread: (id: string) => call<{ ok: true }>("DELETE", `/__api/threads/${id}`, {}),
  stop: (id: string) => call<{ ok: true }>("POST", `/__api/threads/${id}/stop`, {}),
  retry: (id: string) => call<{ ok: true }>("POST", `/__api/threads/${id}/retry`, {}),
  spec: (entry: string) => fetch(`/__api/spec?entry=${encodeURIComponent(entry)}`).then(async (r) => (r.ok ? ((await r.json()) as { markdown: string }).markdown : null)),
};
