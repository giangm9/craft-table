// Texts of the spec and the screen info: MetaEditor, SpecPanel, SpecDoc, SpecBody, SpecEditor, CodeEditor,
// spec-entry. Pattern: ./index.ts. Labels of a board's meta "status" are in values.ts; the title of a spec's intro
// page comes from lib/spec-core.mjs specPages(markdown, { lang }).
// The spec itself (the project's markdown: headings, rules, diagrams) is project data and is never translated; only
// the studio's chrome around it is here. Tested from node by studio/lib/spec-texts.test.mjs.
import { pick } from "./index";

const en = {
  // Shared by the spec panel, the /spec page and the editors.
  behavior: "Behavior",
  tech: "Technical",
  spec: "Spec",
  loading: "Loading…",
  tabEmpty: "This tab has no content yet.",
  noContent: "No content yet.",
  claudeBusy: "Claude is editing this screen",
  close: "Close",
  /** People with the shared document open (spec editor, code pane, screen info form). */
  editors: (n: number) => (n === 1 ? "1 person editing" : `${n} people editing`),
  /** Save state of a shared document (spec editor, code pane). */
  saveStatus: { connecting: "Connecting…", saved: "Saved", saving: "Saving…", offline: "Offline — not saved" },

  // MetaEditor: the screen info form.
  screenInfo: "Screen info",
  connectedAutosave: "Connected · autosave",
  screenName: "Screen name",
  description: "Description",
  status: "Status",
  frames: "Frames",
  viewports: { both: "Desktop + Mobile", desktop: "Desktop", mobile: "Mobile" },
  group: "Group in the list",
  order: "Order",
  scenarios: (n: number) => `Scenarios (${n})`,
  addScenario: "Add scenario",
  scenarioName: "Scenario name",
  moveUp: "Move up",
  moveDown: "Move down",
  deleteScenario: "Delete scenario",
  scenarioId: (id: string) => `ID: ${id}`,
  /** A new scenario with no name yet: the "set ID from name" button shows once it has one. */
  scenarioIdUnnamed: (id: string) => `ID: ${id} — name it, then click`,
  idFromName: "set ID from name",
  /** Plain-language check of a name or description (studio/lib/spec-lint.mjs); `issues` already joined. */
  notPlain: (issues: string) => `Not plain language yet: ${issues}`,

  // SpecPanel: the spec panel left of the board.
  openSpec: "Open spec",
  noSpecWrite: "This screen has no spec yet — click to write one",
  noSpec: "This screen has no spec yet",
  openSeparately: "Open in new tab",
  done: "Done",
  edit: "Edit",
  closeSpec: "Close spec",
  collapseSpec: "Collapse spec",
  collapse: "Collapse",
  /** A tab whose file does not exist yet; `tab` is behavior or tech above. */
  tabMissing: (tab: string) => `${tab} (none yet)`,
  writeOrPreview: "Write or preview",
  write: "Write",
  preview: "Preview",
  loadingSpec: "Loading spec…",
  resizeSpec: "Drag to resize the spec",

  // SpecBody: links to the project's source, embedded code, diagrams (HTML strings; callers escape them).
  srcRefTitle: (ref: string) => `${ref} — click to view the code here, Ctrl+click to open its page`,
  ruleTitle: (rule: string) => `See ${rule} in the other tab`,
  drawingDiagram: "Drawing diagram…",
  srcBadFence: (src: string) => `Couldn't embed code: “${src}”`,
  srcLoading: (ref: string) => `Loading ${ref}…`,
  srcReadFailed: (path: string, status: number) => `Couldn't read ${path} (${status})`,
  openWholeFile: "Open whole file ↗",
  /** An embedded excerpt cut short; `link(text)` makes the link to the whole file. */
  srcMore: (link: (text: string) => string) => `… continues — ${link("see all")}`,
  diagramError: (message: string) => `Diagram syntax error: ${message}`,

  // SpecDoc: table of contents.
  toc: "Contents",

  // SpecEditor.
  notPlainCount: (n: number) => (n === 1 ? "1 place is not plain language yet" : `${n} places are not plain language yet`),

  // CodeEditor: the board's code pane.
  resizeHeight: "Drag to resize",
  closeCode: "Close code pane",
  errorAt: (line: number | null | undefined) => (line ? `Error on line ${line}:` : "Error:"),

  // spec-entry: the /spec page.
  docTitle: (title: string, tab: string) => `${title} · ${tab}`,
  specHeader: (project: string) => (project ? `Spec · ${project}` : "Spec"),
};

const vi: typeof en = {
  behavior: "Hành vi",
  tech: "Kỹ thuật",
  spec: "Đặc tả",
  loading: "Đang tải…",
  tabEmpty: "Tab này chưa có nội dung.",
  noContent: "Chưa có nội dung.",
  claudeBusy: "Claude đang sửa màn này",
  close: "Đóng",
  editors: (n) => `${n} người đang sửa`,
  saveStatus: { connecting: "Đang nối…", saved: "Đã lưu", saving: "Đang lưu…", offline: "Mất kết nối — chưa lưu" },

  screenInfo: "Thông tin màn",
  connectedAutosave: "Đã nối · tự lưu",
  screenName: "Tên màn",
  description: "Mô tả",
  status: "Trạng thái",
  frames: "Khung",
  viewports: { both: "Desktop + Mobile", desktop: "Desktop", mobile: "Mobile" },
  group: "Nhóm trên danh mục",
  order: "Thứ tự",
  scenarios: (n) => `Kịch bản (${n})`,
  addScenario: "Thêm kịch bản",
  scenarioName: "Tên kịch bản",
  moveUp: "Lên",
  moveDown: "Xuống",
  deleteScenario: "Xoá kịch bản",
  scenarioId: (id) => `Mã: ${id}`,
  scenarioIdUnnamed: (id) => `Mã: ${id} — đặt tên rồi bấm`,
  idFromName: "đặt mã theo tên",
  notPlain: (issues) => `Chưa phải lời thường: ${issues}`,

  openSpec: "Mở đặc tả",
  noSpecWrite: "Màn này chưa có đặc tả — bấm để viết",
  noSpec: "Màn này chưa có đặc tả",
  openSeparately: "Mở riêng",
  done: "Xong",
  edit: "Sửa",
  closeSpec: "Đóng đặc tả",
  collapseSpec: "Thu gọn đặc tả",
  collapse: "Thu gọn",
  tabMissing: (tab) => `${tab} (chưa có)`,
  writeOrPreview: "Soạn hay xem trước",
  write: "Soạn",
  preview: "Xem trước",
  loadingSpec: "Đang tải đặc tả…",
  resizeSpec: "Kéo để đổi độ rộng đặc tả",

  srcRefTitle: (ref) => `${ref} — bấm để xem code tại chỗ, Ctrl+bấm để mở trang`,
  ruleTitle: (rule) => `Xem ${rule} ở tab bên kia`,
  drawingDiagram: "Đang vẽ sơ đồ…",
  srcBadFence: (src) => `Không nhúng được code: “${src}”`,
  srcLoading: (ref) => `Đang tải ${ref}…`,
  srcReadFailed: (path, status) => `Không đọc được ${path} (${status})`,
  openWholeFile: "Mở cả file ↗",
  srcMore: (link) => `… còn tiếp — ${link("xem đầy đủ")}`,
  diagramError: (message) => `Sơ đồ lỗi cú pháp: ${message}`,

  toc: "Mục lục",

  notPlainCount: (n) => `${n} chỗ chưa phải lời thường`,

  resizeHeight: "Kéo để đổi chiều cao",
  closeCode: "Đóng ngăn code",
  errorAt: (line) => (line ? `Lỗi dòng ${line}:` : "Lỗi:"),

  docTitle: (title, tab) => `${title} · ${tab}`,
  specHeader: (project) => (project ? `Đặc tả · ${project}` : "Đặc tả"),
};

/** Both languages (tests); the page uses T. */
export const SPEC_TEXTS = { en, vi };
export const T = pick(SPEC_TEXTS);
