// Texts of the conversation panel: ThreadsPanel (thread list, thread, composer, marks list). Pattern: ./index.ts.
// Claude's progress and errors are not here: they are stored as { key, params } and rendered by agent-status.ts.
// The Vietnamese texts are exactly the ones the panel showed in earlier versions: projects' own e2e
// tests match them (lib/threads-texts.test.mjs).
import { locale, pick } from "./index";

const pad = (n: number) => String(n).padStart(2, "0");

const en = {
  // Thread list.
  conversation: "Conversation",
  /** Header of a thread being started; also the button that starts one, and the title of a thread without one. */
  newThread: "New thread",
  noThreads: "No threads yet",
  closedCount: (n: number) => `Closed (${n})`,
  messageCount: (n: number) => (n === 1 ? "1 message" : `${n} messages`),
  /** Preview of the last message when Claude wrote it. */
  fromClaude: (text: string) => `Claude: ${text}`,
  /** Preview of a last message with no text: images only, or marks only. */
  lastImage: "(image)",
  lastMark: "(mark)",
  /** When a message was sent / a thread last changed: the time today, else the date and time. */
  stamp: (d: Date, today: boolean) =>
    today
      ? d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
      : d.toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  // Badges of a thread in the list.
  working: "Claude is working",
  queuedBadge: "Queued",
  queuedHint: "Waiting for Claude to finish another thread of this screen",
  errorBadge: "Error",
  closedBadge: "Closed",
  /** Claude asked something and waits for the person. */
  yourTurn: "Your turn",
  // Header of a thread.
  backToThreads: "Back to threads",
  close: "Close",
  renamePrompt: "Rename thread",
  rename: "Rename",
  marksToggle: "Marks — remove or redraw",
  closeThread: "Close thread (done)",
  reopenThread: "Reopen thread",
  deleteThread: "Delete thread",
  deleteConfirm: "Delete this thread?",
  // Marks: chips and the marks list.
  markRemoved: "Mark removed",
  chipRemove: "Remove mark",
  removeMark: "Remove mark",
  restore: "Restore",
  redraw: "Redraw",
  redrawing: "Redrawing",
  redrawHint: "Redraw this mark on the canvas (keeps its number)",
  statusRemoved: "removed",
  statusRedrawn: "redrawn",
  /** Where a mark or message was made when it is another screen of the group; label = "the main screen", "option “X”"… */
  onMember: (label: string) => `on ${label}`,
  // Conversations belong to the version, not to a screen: a screen is named inside the message with "@".
  noThreadsGlobal: "Ask for anything about the design — a change on one screen or on all of them. Mention a screen with @.",
  messageClaudeGlobal: "Ask for a change — type @ to mention a screen…",
  mention: "Screen",
  mentionHint: "Mention a screen in your message (or type @)",
  mentionMenu: "Screens",
  mentionNone: "No screen matches",
  mentionGone: "This screen is no longer in this version",
  /** On a message sent while looking at a screen: `title` is that screen. */
  lookingAt: (title: string) => `looking at ${title}`,
  scriptsOn: (backend: string) => `Scripts: ${backend}`,
  scriptsOff: "Scripts: off",
  // Messages and Claude's turn.
  openImage: "Open image",
  attachedImage: "Attached image",
  workingLong: "Claude is working…",
  stop: "Stop",
  waitingTurn: "Waiting for its turn",
  busyElsewhere: "Claude is editing this screen in another thread.",
  unqueue: "Leave the queue",
  turnFailed: "Claude's turn failed",
  runAgain: "Run again",
  askClaude: "Ask Claude to reply",
  // Composer.
  messageClaude: "Message Claude…",
  reply: "Reply…",
  replyToReopen: "Send to reopen the thread…",
  markHint: "Mark an area on the canvas to attach it to your message (C)",
  mark: "Mark",
  marking: "Marking",
  attachHint: (max: number) => `Attach images (up to ${max}) — or paste or drop them here`,
  image: "Image",
  removeImage: "Remove image",
  shrinkComposer: "Shrink the composer",
  shrinkComposerHint: "Shrink the composer (Esc)",
  openBigComposer: "Open the large composer",
  openBigComposerHint: "Open the large composer — for long, multi-paragraph text",
  send: "Send",
  sendHint: "Send (Enter) · Shift+Enter for a new line",
  sendHintBig: "Send (Ctrl+Enter)",
  /** Title of the large composer. */
  compose: "Write a message",
};

const vi: typeof en = {
  conversation: "Hội thoại",
  newThread: "Luồng mới",
  noThreads: "Chưa có luồng nào",
  closedCount: (n) => `Đã đóng (${n})`,
  messageCount: (n) => `${n} tin`,
  fromClaude: (text) => `Claude: ${text}`,
  lastImage: "(ảnh)",
  lastMark: "(khoanh)",
  // Written out by hand: exactly the form the panel always showed (HH:MM, then DD/MM on another day).
  stamp: (d, today) => {
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return today ? t : `${t} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  },
  working: "Claude đang làm",
  queuedBadge: "Chờ lượt",
  queuedHint: "Chờ Claude xong luồng khác trên màn này",
  errorBadge: "Lỗi",
  closedBadge: "Đã đóng",
  yourTurn: "Chờ bạn",
  backToThreads: "Về danh sách luồng",
  close: "Đóng",
  renamePrompt: "Đổi tên luồng",
  rename: "Đổi tên",
  marksToggle: "Danh sách khoanh — bỏ hoặc vẽ lại",
  closeThread: "Đóng luồng (đã xong)",
  reopenThread: "Mở lại luồng",
  deleteThread: "Xoá luồng",
  deleteConfirm: "Xoá luồng này?",
  markRemoved: "Khoanh đã bỏ",
  chipRemove: "Bỏ vùng khoanh",
  removeMark: "Bỏ khoanh",
  restore: "Khôi phục",
  redraw: "Vẽ lại",
  redrawing: "Đang vẽ lại",
  redrawHint: "Vẽ lại vùng này trên bảng vẽ (giữ số)",
  statusRemoved: "đã bỏ",
  statusRedrawn: "đã vẽ lại",
  onMember: (label) => `trên ${label}`,
  noThreadsGlobal: "Nhờ bất cứ điều gì về thiết kế — đổi một màn hay đổi tất cả. Nhắc một màn bằng @.",
  messageClaudeGlobal: "Nhờ đổi gì đó — gõ @ để nhắc một màn…",
  mention: "Màn",
  mentionHint: "Nhắc một màn trong tin nhắn (hoặc gõ @)",
  mentionMenu: "Các màn",
  mentionNone: "Không có màn nào khớp",
  mentionGone: "Màn này không còn trong phiên bản này",
  lookingAt: (title) => `đang xem ${title}`,
  scriptsOn: (backend) => `Script: ${backend}`,
  scriptsOff: "Script: tắt",
  openImage: "Mở ảnh",
  attachedImage: "Ảnh đính kèm",
  workingLong: "Claude đang làm…",
  stop: "Dừng",
  waitingTurn: "Đang chờ lượt",
  busyElsewhere: "Claude đang sửa màn này ở luồng khác.",
  unqueue: "Bỏ chờ",
  turnFailed: "Lượt của Claude bị lỗi",
  runAgain: "Chạy lại",
  askClaude: "Gửi cho Claude trả lời",
  messageClaude: "Nhắn Claude…",
  reply: "Trả lời…",
  replyToReopen: "Gửi để mở lại luồng…",
  markHint: "Khoanh vùng trên bảng vẽ để gắn vào tin (phím C)",
  mark: "Khoanh",
  marking: "Đang khoanh",
  attachHint: (max) => `Đính kèm ảnh (tối đa ${max}) — hoặc dán / kéo thả ảnh vào đây`,
  image: "Ảnh",
  removeImage: "Bỏ ảnh",
  shrinkComposer: "Thu nhỏ ô soạn",
  shrinkComposerHint: "Thu nhỏ ô soạn (Esc)",
  openBigComposer: "Mở khung soạn lớn",
  openBigComposerHint: "Mở khung soạn lớn — gõ văn bản nhiều đoạn",
  send: "Gửi",
  sendHint: "Gửi (Enter) · Shift+Enter để xuống dòng",
  sendHintBig: "Gửi (Ctrl+Enter)",
  compose: "Soạn tin",
};

/** Both languages (tests); the panel uses T. */
export const TEXTS = { en, vi };
export const T = pick(TEXTS);

/** A thread's title as shown; one stored without a title gets the default name in this page's language. */
export const threadTitle = (title: string | undefined) => title?.trim() || T.newThread;
