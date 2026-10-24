// Texts of history, versions and options: HistoryPanel, VersionsPage, versions-entry, OptionsUi. Pattern: ./index.ts.
// Labels of version / option statuses and history authors are in values.ts; history notes are rendered by
// agent-status.ts (storedText).
// A text with elements inside (a bold title, a button, a coloured word) is one function that takes the nodes and
// returns the parts in this language's order; the component renders them with createElement(Fragment, null, ...parts).
// Unit test: studio/lib/history-i18n.test.mjs (the vi side is word for word what the studio showed in earlier versions).
import type { ReactNode } from "react";
import { pick } from "./index";

const en = {
  // ── HistoryPanel: the History tab of a screen ──
  /** Time of a snapshot and the day heading of a group (toLocaleTimeString / toLocaleDateString options). */
  timeFormat: { hour: "numeric", minute: "2-digit" } as Intl.DateTimeFormatOptions,
  dayFormat: { weekday: "short", month: "short", day: "numeric", year: "numeric" } as Intl.DateTimeFormatOptions,
  /** A screen's files, by suffix: <id>.behavior.md, <id>.tech.md, <id>.meta.json, <id>.tsx. */
  file: { behavior: "Behavior", tech: "Technical", meta: "Info", board: "Board" },
  /** Badge of a snapshot by its source (history list). */
  badge: { restore: "Restored", option: "Option adopted", init: "Initial" },
  /** Author of a snapshot Claude wrote in a thread (title unknown: the thread was deleted). */
  claudeInThread: (title: string | null) => `Claude · ${title ?? "thread"}`,
  /** Author "claude@local": a request from this machine. */
  localClaude: "Claude (this machine)",
  sameAsCurrent: "Same as the current content.",
  /** Folded run of unchanged lines in a diff. */
  unchangedLines: (n: number) => `… ${n} unchanged ${n === 1 ? "line" : "lines"}`,
  openSnapshotFailed: (status: number) => `Couldn't open this snapshot (${status})`,
  /** Back link from a snapshot to the list. */
  backToHistory: "History",
  restore: "Restore",
  /** `what` of LoadError (studio/ui) for a snapshot / the history list. */
  loadSnapshot: "this snapshot",
  loadHistory: "the history",
  loading: "Loading…",
  /** Heading of an open snapshot: file label, date, time. */
  snapshotHeading: (p: { file: string; day: string; time: string }) => `${p.file} · ${p.day}, ${p.time}`,
  /** Legend of the diff colours; `added` / `removed` render a word in the diff's colour. */
  restoreLegend: (added: (word: string) => ReactNode, removed: (word: string) => ReactNode): ReactNode[] => [
    "Restoring brings back ", added("green"), " and drops ", removed("red"), ".",
  ],
  restored: "Restored, as a new snapshot in the history.",
  fileGone: "This file no longer exists. Restoring will create it again.",
  restoreTitle: (p: { file: string; day: string; time: string }) => `Restore ${p.file} to ${p.time}, ${p.day}?`,
  restoreConfirm: "Restore this snapshot",
  restoreFailed: (status: number) => `Restore failed (${status})`,
  restoreKeepsCurrent: "The current content is not lost: it stays in the history, and you can restore it back.",
  noSnapshots: "No snapshots yet.",

  // ── VersionsPage (/versions) ──
  backToStudio: "Back to the studio",
  versionsTitle: "Versions",
  versionsIntro:
    "Each version is a full copy of the whole app in the studio (boards, specs, design system). Designing a new version doesn't change the live one; small changes within a version are recorded in each screen's History.",
  loadVersions: "the version list",
  /** Badge of the live version. */
  live: "Live",
  /** Facts of a version row, joined with " · ". */
  created: (date: string) => `Created ${date}`,
  copiedFrom: (title: string) => `copied from ${title}`,
  original: "original",
  changedScreens: (n: number) => (n === 1 ? "1 screen changed" : `${n} screens changed`),
  statusOf: (title: string) => `Status of ${title}`,
  open: "Open",
  editVersion: (title: string) => `Edit ${title}`,
  newFromHere: "New version from here",
  setLive: "Set as live",
  newVersionFrom: (title: string) => `New version from ${title}`,
  cancel: "Cancel",
  saving: "Saving…",
  createCopy: "Create copy",
  save: "Save",
  versionName: "Version name",
  note: "Note",
  setLiveTitle: (title: string) => `Set ${title} as the live version?`,
  setLiveBody: "Only do this once this version has been built into the real app. The studio will open it by default; the old version stays as it is, for reference.",

  // ── OptionsUi: the new-option dialog, the option bar and its dialogs ──
  /** Title of the new-option dialog (also the aria-label of the header button in main.tsx). */
  createOption: "New option",
  create: "Create",
  optionName: "Option name",
  optionScreens: "Screens in this option",
  thisScreen: (title: string) => `${title} (this screen)`,
  renameOption: "Rename option",
  quoted: (s: string) => `“${s}”`,
  /** The option bar: name (bold, quoted), rename button, main screen (a link), status label. */
  optionBar: (p: { name: ReactNode; rename: ReactNode; main: ReactNode; status: string }): ReactNode[] => [
    "Option ", p.name, p.rename, "of ", p.main, " · ", p.status,
  ],
  removeOption: "Remove option",
  adoptAgain: "Adopt again",
  adoptThis: "Adopt this option",
  adoptTitle: "Adopt this option?",
  adopt: "Adopt",
  adoptBody: (main: ReactNode): ReactNode[] => ["Copies over the ", main, " screen. The old one can still be restored from the History tab."],
  removeTitle: "Remove this option?",
  removeBody: (main: ReactNode): ReactNode[] => ["The ", main, " screen stays as it is."],
};

const vi: typeof en = {
  timeFormat: { hour: "2-digit", minute: "2-digit" },
  dayFormat: { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" },
  file: { behavior: "Hành vi", tech: "Kỹ thuật", meta: "Thông tin", board: "Bản vẽ" },
  badge: { restore: "khôi phục", option: "chốt phương án", init: "khởi tạo" },
  claudeInThread: (title) => `Claude · ${title ?? "luồng"}`,
  localClaude: "Claude (máy chủ)",
  sameAsCurrent: "Giống hệt nội dung hiện tại.",
  unchangedLines: (n) => `… ${n} dòng không đổi`,
  openSnapshotFailed: (status) => `Không mở được mốc (${status})`,
  backToHistory: "Lịch sử",
  restore: "Khôi phục",
  loadSnapshot: "mốc này",
  loadHistory: "lịch sử",
  loading: "Đang tải…",
  snapshotHeading: (p) => `${p.file} · ${p.day} ${p.time}`,
  restoreLegend: (added, removed) => ["Khôi phục: ", added("xanh"), " có lại, ", removed("đỏ"), " mất."],
  restored: "Đã khôi phục — thành một mốc mới trong lịch sử.",
  fileGone: "File này hiện không còn — khôi phục sẽ tạo lại.",
  restoreTitle: (p) => `Khôi phục ${p.file} về lúc ${p.time} ${p.day}?`,
  restoreConfirm: "Khôi phục bản này",
  restoreFailed: (status) => `Khôi phục hỏng (${status})`,
  restoreKeepsCurrent: "Nội dung hiện tại không mất: nó vẫn nằm trong lịch sử, khôi phục ngược lại được.",
  noSnapshots: "Chưa có mốc nào.",

  backToStudio: "Về xưởng",
  versionsTitle: "Phiên bản",
  versionsIntro:
    "Mỗi phiên bản là một bản sao đầy đủ của cả app trong xưởng (bản vẽ, đặc tả, design system). Thiết kế bản mới không làm đổi bản đang chạy; thay đổi nhỏ trong một bản được ghi ở Lịch sử của từng màn.",
  loadVersions: "danh sách phiên bản",
  live: "Đang chạy",
  created: (date) => `Tạo ${date}`,
  copiedFrom: (title) => `chép từ ${title}`,
  original: "bản gốc",
  changedScreens: (n) => `${n} màn đã đổi`,
  statusOf: (title) => `Trạng thái ${title}`,
  open: "Mở",
  editVersion: (title) => `Sửa ${title}`,
  newFromHere: "Tạo bản mới từ đây",
  setLive: "Đặt đang chạy",
  newVersionFrom: (title) => `Tạo phiên bản mới từ ${title}`,
  cancel: "Huỷ",
  saving: "Đang lưu…",
  createCopy: "Tạo bản sao",
  save: "Lưu",
  versionName: "Tên phiên bản",
  note: "Ghi chú",
  setLiveTitle: (title) => `Đặt ${title} là bản đang chạy?`,
  setLiveBody: "Chỉ làm khi bản này đã được làm vào app thật. Xưởng sẽ mở bản này mặc định; bản cũ vẫn giữ nguyên để xem lại.",

  createOption: "Tạo phương án",
  create: "Tạo",
  optionName: "Tên phương án",
  optionScreens: "Màn trong phương án",
  thisScreen: (title) => `${title} (màn đang xem)`,
  renameOption: "Đổi tên phương án",
  quoted: (s) => `“${s}”`,
  optionBar: (p) => ["Phương án ", p.name, p.rename, "của màn ", p.main, " · ", p.status],
  removeOption: "Bỏ phương án",
  adoptAgain: "Chốt lại",
  adoptThis: "Chốt phương án này",
  adoptTitle: "Chốt phương án?",
  adopt: "Chốt",
  adoptBody: (main) => ["Chép đè lên màn ", main, ". Bản cũ vẫn khôi phục được ở tab Lịch sử."],
  removeTitle: "Bỏ phương án?",
  removeBody: (main) => ["Màn ", main, " không đổi."],
};

/** Both languages (for the unit test); components use T. */
export const HISTORY_TEXTS = { en, vi };
export const T = pick(HISTORY_TEXTS);
