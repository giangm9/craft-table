// Texts the studio stores in data as { key, params? } — words in no language, rendered in each viewer's language:
//   • thread.agent.progress / thread.agent.error (studio/lib/agent.mjs, studio/threads-api.mjs);
//   • history notes (studio/server.mjs, studio/lib/history-recorder.mjs).
// A plain string is free text (from the SDK or Claude) or a value stored by earlier versions: shown as it is.
// The keys are stored forever: never rename one; add a new key instead. No imports (node tests load this file).

type Params = Record<string, unknown>;
type Text = string | ((p: Params) => string);
export type StoredText = string | { key: string; params?: Params };

const s = (v: unknown) => String(v ?? "");
const frame = (p: Params) => [p.entry, p.scenario, p.viewport].filter(Boolean).join(" · ");

const en = {
  // What Claude is doing (one per studio tool).
  listing: (p: Params) => `Listing ${s(p.what)}`.trim(),
  reading: (p: Params) => `Reading ${s(p.path)}`,
  searching: (p: Params) => `Searching for "${s(p.pattern)}"`,
  readingThread: "Rereading the thread",
  viewingFrame: (p: Params) => `Looking at the frame ${frame(p)}`,
  viewingMark: (p: Params) => `Looking at mark #${p.n}`,
  viewingImage: "Looking at the attached image",
  locating: (p: Params) => `Locating "${s(p.text)}"`,
  editing: (p: Params) => `Editing ${s(p.path)}`,
  checking: (p: Params) => `Checking: ${s(p.what)}`,
  readingRules: (p: Params) => `Reading the rules: ${s(p.topic)}`,
  replacing: (p: Params) => `Replacing across files: ${s(p.pattern)}`,
  browsing: (p: Params) => (p.what === "all" ? "Looking at all screens" : `Looking at ${s(p.what)} screens`),
  running: (p: Params) => `Running: ${s(p.command)}`,
  compacting: () => "Compacting the conversation…",
  usingTool: (p: Params) => `Using ${s(p.name)}`,
  // A turn's state.
  queued: "Waiting for Claude to finish another thread of this screen",
  readingConversation: "Reading the conversation…",
  // Why a turn failed.
  restarted: "The studio restarted during this turn. Run it again.",
  timedOut: (p: Params) => `took more than ${s(p.minutes)} minutes`,
  stoppedTimedOut: (p: Params) => `stopped (took more than ${s(p.minutes)} minutes)`,
  userStopped: "someone pressed Stop",
  stoppedByUser: "stopped (someone pressed Stop)",
  sandboxLeak: (p: Params) => `sandbox not sealed — tools from outside the studio: ${s(p.tools)}`,
  stoppedSandboxLeak: (p: Params) => `stopped (sandbox not sealed — tools from outside the studio: ${s(p.tools)})`,
  loginLost: (p: Params) => `Claude in the studio is signed out. The studio's admin can sign it in again with: ${s(p.command)}`,
  noResult: "no result",
  // History notes.
  restoredSnapshot: (p: Params) => `restored snapshot #${s(p.id)} (${s(p.ts)})`,
  adoptedOption: (p: Params) => `adopted option "${s(p.name)}"`,
  changedWhileOff: "changed while the studio was off",
} satisfies Record<string, Text>;

const vi: typeof en = {
  listing: (p) => `Đang xem danh sách ${s(p.what)}`.trim(),
  reading: (p) => `Đang đọc ${s(p.path)}`,
  searching: (p) => `Đang tìm "${s(p.pattern)}"`,
  readingThread: "Đang đọc lại luồng",
  viewingFrame: (p) => `Đang xem khung ${frame(p)}`,
  viewingMark: (p) => `Đang xem vùng khoanh #${p.n}`,
  viewingImage: "Đang xem ảnh đính kèm",
  locating: (p) => `Đang tìm vị trí "${s(p.text)}"`,
  editing: (p) => `Đang sửa ${s(p.path)}`,
  checking: (p) => `Đang kiểm: ${s(p.what)}`,
  readingRules: (p) => `Đang đọc luật ${s(p.topic)}`,
  replacing: (p) => `Đang thay trên nhiều file: ${s(p.pattern)}`,
  browsing: (p) => (p.what === "all" ? "Đang xem mọi màn" : `Đang xem ${s(p.what)} màn`),
  running: (p) => `Đang chạy: ${s(p.command)}`,
  compacting: () => "Đang thu gọn hội thoại…",
  usingTool: (p) => `Đang dùng ${s(p.name)}`,
  queued: "Chờ Claude xong luồng khác trên màn này",
  readingConversation: "Đang đọc hội thoại…",
  restarted: "Xưởng khởi động lại giữa lượt — bấm Chạy lại.",
  timedOut: (p) => `quá ${s(p.minutes)} phút`,
  stoppedTimedOut: (p) => `dừng (quá ${s(p.minutes)} phút)`,
  userStopped: "người dùng bấm Dừng",
  stoppedByUser: "dừng (người dùng bấm Dừng)",
  sandboxLeak: (p) => `sandbox hở — có công cụ ngoài xưởng: ${s(p.tools)}`,
  stoppedSandboxLeak: (p) => `dừng (sandbox hở — có công cụ ngoài xưởng: ${s(p.tools)})`,
  loginLost: (p) => `Claude trong xưởng mất đăng nhập. Người quản trị xưởng nạp lại bằng lệnh: ${s(p.command)}`,
  noResult: "không có kết quả",
  restoredSnapshot: (p) => `khôi phục mốc #${s(p.id)} (${s(p.ts)})`,
  adoptedOption: (p) => `chốt phương án "${s(p.name)}"`,
  changedWhileOff: "đổi khi xưởng tắt",
};

export const STORED_TEXTS = { en, vi };

/** A stored text in one language's dictionary: a string as it is; { key } → its text (unknown key → the key). */
export function renderStored(dict: Record<string, Text>, x: StoredText | null | undefined): string | null {
  if (x == null) return null;
  if (typeof x === "string") return x;
  if (typeof x !== "object" || typeof x.key !== "string") return String(x);
  const t = Object.hasOwn(dict, x.key) ? dict[x.key] : undefined;
  if (t === undefined) return x.key;
  return typeof t === "function" ? t(x.params ?? {}) : t;
}
