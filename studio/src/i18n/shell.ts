// Texts of the studio's shell: main.tsx, Sidebar, Canvas, Frame, frame-entry, PanelAside, and the chrome of api.ts,
// collab.ts, project.ts. Pattern: ./index.ts.
import { pick } from "./index";

const scenariosEn = (n: number) => `${n} ${n === 1 ? "scenario" : "scenarios"}`;
const scenariosVi = (n: number) => `${n} kịch bản`;

const en = {
  // PanelAside: the handle on the left edge of the right panel (Conversation / History).
  panelResizeLabel: "Drag to resize the conversation panel",
  panelResizeHint: "Drag to resize · double-click to reset",

  // Sidebar head and foot (main.tsx).
  studioTagline: "Design studio",
  signOut: "Sign out",
  /** LangSwitch: the select's label. */
  language: "Language",

  // Header (main.tsx).
  /** Phone: the button that opens the board list drawer. */
  boardList: "Boards",
  closeCode: "Close the code pane",
  openCode: "Edit the board's code (shared editing)",
  boardCode: "Board code",
  createOptionHint: "New option: a copy to try another direction, the main screen stays as it is",
  /** Same words as the new-option dialog's title (history.ts createOption). */
  createOption: "New option",
  editScreenInfoHint: "Edit screen info (name, description, scenarios)",
  editScreenInfo: "Edit screen info",
  scenarioCount: scenariosEn,
  version: "Version",
  /** An entry of the version select. */
  versionOption: ({ title, live }: { title: string; live: boolean }) => `${title}${live ? " · live" : ""}`,
  manageVersions: "Manage versions…",
  compare: "Compare",
  noCompare: "No comparison",
  compareWith: (title: string) => `Compare with ${title}`,
  phone: "Phone",
  /** The phone select's "whole page" entry on wide screens (on phones it shows the device name alone). */
  fullDeviceWide: "Whole page · free height",
  frames: "Frames",
  viewportBoth: "Desktop + Mobile",
  viewport: { desktop: "Desktop", mobile: "Mobile" },
  openSpec: "Open the spec panel",
  collapseSpec: "Collapse the spec panel",
  spec: "Spec",
  theme: "Theme",
  themeLight: "Light",
  themeDark: "Dark",
  markHint: "Mark an area to attach to your message (C, Esc to exit)",
  mark: "Mark",
  marking: "Marking",
  /** The mark button while redrawing mark `mark` ("#2" sent, "+1" not sent yet). */
  redrawing: (mark: string) => `Redraw ${mark}`,
  conversation: "Conversation",
  history: "History",
  floatPanel: "Pop the conversation out as a floating window",
  dockPanel: "Put the conversation back in the side panel",
  floatMoveHint: "Drag to move",
  floatResizeHint: "Drag to resize",
  noBoards: (version: string) => `No boards yet in versions/${version}/boards/.`,
  /** Avatars of the other people in the studio. */
  othersHere: (n: number) => (n === 1 ? "1 other person has the studio open" : `${n} other people have the studio open`),
  /** An avatar's label: who, where (a board's title; none = the board list), and the version when not this one. */
  peerLabel: ({ name, where, version }: { name: string; where?: string; version?: string }) =>
    `${name} · viewing ${where ?? "the board list"}${version ? ` (${version})` : ""}`,
  // Short name of a screen of the group (main screen + its options), on threads and messages of another screen.
  mainScreen: "the main screen",
  removedOption: "a removed option",
  optionNamed: (name: string) => `option “${name}”`,

  // Sidebar.
  otherSection: "Other",
  searchBoards: "Search boards…",
  clearSearch: "Clear search",
  noMatch: (q: string) => `No boards match “${q}”.`,
  optionRowTitle: ({ name, of, status }: { name: string; of: string; status: string }) => `Option “${name}” of ${of} · ${status}`,
  boardRowTitle: ({ title, n }: { title: string; n: number }) => `${title} · ${scenariosEn(n)}`,
  changedHint: "Changed from the source version",
  /** Title of the red badge on a screen: the conversations waiting for the person that mention the screen. */
  attentionHint: (titles: string) => `Waiting for you: ${titles}`,
  changedLabel: "changed from the source version",
  viewingNow: (names: string) => `Viewing: ${names}`,

  // Canvas zoom bar.
  zoomOut: "Zoom out",
  zoomOutHint: "Zoom out (mouse wheel)",
  zoomReset: "Reset to 100%",
  zoomIn: "Zoom in",
  zoomInHint: "Zoom in (mouse wheel)",
  fit: "Fit to screen",

  // Frame label.
  openFrameHint: "Open this frame in a new tab",
  openFrame: "Open",

  // frame-entry (drawn inside a board's frame, in the viewer's language).
  boardError: ({ line, message }: { line: number | null; message: string }) => `Error${line ? ` on line ${line}` : ""}: ${message}`,
  boardMissing: ({ version, id }: { version: string; id: string }) => `Version “${version}” has no board “${id}”.`,
  /** Tab title of a frame opened on its own (frame.html's own <title> is neutral). */
  frameTitle: "Frame",

  // collab.ts: names shown for people (presence, co-editing).
  localUser: "Claude (this machine)",
  guest: "guest",
};

const vi: typeof en = {
  panelResizeLabel: "Kéo để đổi độ rộng ngăn hội thoại",
  panelResizeHint: "Kéo để đổi độ rộng · bấm đúp để về mặc định",

  studioTagline: "Xưởng thiết kế",
  signOut: "Đăng xuất",
  language: "Ngôn ngữ",

  boardList: "Danh mục",
  closeCode: "Đóng ngăn code",
  openCode: "Sửa code bản vẽ (cùng sửa)",
  boardCode: "Code bản vẽ",
  createOptionHint: "Tạo phương án — bản sao để thử hướng khác, màn chính giữ nguyên",
  createOption: "Tạo phương án",
  editScreenInfoHint: "Sửa thông tin màn (tên, mô tả, kịch bản)",
  editScreenInfo: "Sửa thông tin màn",
  scenarioCount: scenariosVi,
  version: "Phiên bản",
  versionOption: ({ title, live }) => `${title}${live ? " · đang chạy" : ""}`,
  manageVersions: "Quản lý phiên bản…",
  compare: "So sánh",
  noCompare: "Không so sánh",
  compareWith: (title) => `So với ${title}`,
  phone: "Điện thoại",
  fullDeviceWide: "Cả trang · cao tự do",
  frames: "Khung",
  viewportBoth: "Desktop + Mobile",
  viewport: { desktop: "Desktop", mobile: "Mobile" },
  openSpec: "Mở bảng đặc tả",
  collapseSpec: "Thu gọn bảng đặc tả",
  spec: "Đặc tả",
  theme: "Giao diện",
  themeLight: "Sáng",
  themeDark: "Tối",
  markHint: "Khoanh vùng để gắn vào tin nhắn (phím C, Esc để thoát)",
  mark: "Khoanh",
  marking: "Đang khoanh",
  redrawing: (mark) => `Vẽ lại ${mark}`,
  conversation: "Hội thoại",
  history: "Lịch sử",
  floatPanel: "Tách hội thoại thành cửa sổ nổi",
  dockPanel: "Gắn hội thoại lại vào khung bên phải",
  floatMoveHint: "Kéo để di chuyển",
  floatResizeHint: "Kéo để đổi cỡ",
  noBoards: (version) => `Chưa có bản vẽ nào trong versions/${version}/boards/.`,
  othersHere: (n) => `${n} người khác đang mở xưởng`,
  peerLabel: ({ name, where, version }) => `${name} · đang xem ${where ?? "danh mục"}${version ? ` (${version})` : ""}`,
  mainScreen: "màn chính",
  removedOption: "phương án đã bỏ",
  optionNamed: (name) => `phương án “${name}”`,

  otherSection: "Khác",
  searchBoards: "Tìm bản vẽ…",
  clearSearch: "Xoá tìm",
  noMatch: (q) => `Không có bản vẽ khớp “${q}”.`,
  optionRowTitle: ({ name, of, status }) => `Phương án “${name}” của ${of} · ${status}`,
  boardRowTitle: ({ title, n }) => `${title} · ${scenariosVi(n)}`,
  changedHint: "Khác bản nguồn",
  attentionHint: (titles) => `Đang chờ bạn: ${titles}`,
  changedLabel: "đã đổi so với bản nguồn",
  viewingNow: (names) => `Đang xem: ${names}`,

  zoomOut: "Thu nhỏ",
  zoomOutHint: "Thu nhỏ (lăn chuột)",
  zoomReset: "Về 100%",
  zoomIn: "Phóng to",
  zoomInHint: "Phóng to (lăn chuột)",
  fit: "Vừa màn",

  openFrameHint: "Mở khung riêng",
  openFrame: "Mở riêng",

  boardError: ({ line, message }) => `Lỗi${line ? ` dòng ${line}` : ""}: ${message}`,
  boardMissing: ({ version, id }) => `Phiên bản “${version}” không có bản vẽ “${id}”.`,
  frameTitle: "Khung",

  localUser: "Claude (máy)",
  guest: "khách",
};

/** Both languages (for the unit test, studio/lib/shell-i18n.test.mjs); components use T. */
export const SHELL_TEXTS = { en, vi };
export const T = pick(SHELL_TEXTS);

/** The user of requests from this machine (Claude's own browser, chat.mjs): no sign-in (studio/lib/session.mjs). */
export const LOCAL_USER = "claude@local";

/** Name shown for a person: this machine's user → "Claude (this machine)", else the part of the email before "@". */
export const personName = (email: string, t: Pick<typeof en, "localUser" | "guest"> = T) =>
  email === LOCAL_USER ? t.localUser : email.split("@")[0] || t.guest;

/**
 * A person received from another tab (presence, co-editing), named in THIS viewer's language: the name the sender
 * put in its awareness state is in the sender's language, so it is derived again from the email.
 */
export const withViewerName = <W extends { name: string; email: string }>(w: W): W => ({ ...w, name: personName(w.email) });
