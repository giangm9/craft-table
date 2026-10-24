// Texts of the data libs (studio/lib/versions.mjs, options.mjs, thread-core.mjs, spec-core.mjs, frame-version.mjs…).
//   • Errors a VIEWER meets: versions.mjs / options.mjs throw StudioError (code + params), translated where they leave
//     the server in the viewer's language (lib/i18n.mjs errorText); thread-core returns { ok: false, code, params,
//     error } with `error` worded in the `lang` its caller passes (the viewer's at the API).
//   • Texts CLAUDE reads (optionMetaIssue, transcript, the "@ds" plugin errors): the PROJECT language, passed as
//     { lang }.
// Shape (checked by lib/i18n.test.mjs): the same keys in en and vi; a value is a string or (params) => string.
// Keys must not repeat those of server.mjs (both are looked up at the server boundary).
// The Vietnamese texts are the studio's wording of earlier versions, word for word.

/** The shape of an option's "option" field, as Claude is told to write it (the status is a stored code). */
const shapeEn = (base) => `"option": { "of": "${base}", "name": "<short name, e.g. A. Compact rows>", "status": "trying" }`;
const shapeVi = (base) => `"option": { "of": "${base}", "name": "<tên ngắn, vd A. Bản gọn>", "status": "trying" }`;
const FRAME_EN = "Can't open the frame: no live version is known";
const FRAME_HINT_EN = "Open the frame with ?v=<version> to see a specific version.";
const FRAME_VI = "Không mở được khung: chưa biết phiên bản nào đang chạy";
const FRAME_HINT_VI = "Mở khung kèm ?v=<phiên-bản> để xem một bản cụ thể.";

const DATA = {
  en: {
    // versions.mjs (viewer)
    badVersionStatus: ({ status }) => `Invalid status: ${status}`,
    versionIdInvalid: ({ id }) => `Invalid version id: ${id}`,
    versionSourceMissing: ({ id }) => `Version ${id} does not exist`,
    versionTitleMissing: "The version needs a name",
    // options.mjs (viewer)
    optionVersionMissing: ({ id }) => `No such version: ${id}`,
    optionNameMissing: "The option needs a name",
    optionNoScreens: "Pick at least one screen",
    optionScreenIdInvalid: ({ id }) => `Invalid screen id: ${id}`,
    optionScreenIsOption: ({ id }) => `This screen is already an option: ${id}`,
    optionScreenMissing: ({ id }) => `No such screen: ${id}`,
    optionNotOption: ({ id }) => `Not an option: ${id}`,
    optionMissing: ({ id }) => `No such option: ${id}`,
    // option-meta.mjs optionMetaIssue (Claude)
    optionMetaNotJson: ({ base }) => `The info file must be valid JSON (an option needs ${shapeEn(base)}).`,
    optionMetaNotObject: ({ base }) => `An option needs ${shapeEn(base)} — not plain text.`,
    optionMetaBadOf: ({ base }) => `option.of must be the main screen "${base}". Correct shape: ${shapeEn(base)}.`,
    optionMetaBadName: ({ base }) => `option.name must be the option's short name. Correct shape: ${shapeEn(base)}.`,
    optionMetaBadStatus: ({ base }) => `option.status must be "trying" (or "adopted"). Correct shape: ${shapeEn(base)}.`,
    // thread-core.mjs newThread / addMessage / editRef (viewer)
    threadEntryInvalid: "Invalid board",
    threadVersionInvalid: "Invalid version",
    threadTitleMissing: "The thread needs a title",
    messageRoleInvalid: "role must be user|claude",
    messageTooLong: "The message is too long",
    messageTooManyMarks: "Too many marks",
    markInvalid: "Invalid mark",
    messageViewingOutside: "The screen being viewed is not part of this thread",
    messageTooManyImages: ({ max }) => `At most ${max} images per message`,
    messageImageInvalid: "Invalid attached image",
    messageEmpty: "The message is empty",
    markMissing: "No such mark",
    markAlreadyRemoved: "This mark was removed",
    markNotRemoved: "This mark is not removed",
    markRemovedRestoreFirst: "This mark was removed — restore it before redrawing",
    markActionInvalid: "action must be remove|restore|redraw",
    // thread-core.mjs transcript (Claude)
    transcriptClaude: "Claude (you, an earlier turn)",
    transcriptOnlyImages: "(images only, no text)",
    transcriptOnlyMarks: "(marks only, no text)",
    transcriptMarks: "Marks attached to this message:",
    transcriptImages: "Images the person attached to this message (use Read to view each one):",
    transcriptImage: ({ n, path }) => `image ${n}: ${path}`,
    transcriptMarkRemoved: ({ n }) => `[#${n}] removed (the person removed this mark)`,
    transcriptMark: ({ n, scenario, viewport, x, y, w, h, texts }) =>
      `[#${n}] scenario ${scenario ?? "(default)"} · ${viewport} · x=${x} y=${y} w=${w} h=${h}${texts ? ` · text: ${texts}` : ""}`,
    // spec-core.mjs specPages (viewer): the page made of the text before the first ##
    specOverview: "Overview",
    // frame-version.mjs (viewer, in a board's frame)
    frameUnreachable: ({ detail }) => `${FRAME_EN} — the studio server could not be reached (${detail}). ${FRAME_HINT_EN}`,
    frameServerError: ({ status, detail }) => `${FRAME_EN} — the studio server returned error ${status}${detail ? `: ${detail}` : ""}. ${FRAME_HINT_EN}`,
    frameUnreadable: `${FRAME_EN} — the studio server sent data it could not read. ${FRAME_HINT_EN}`,
    frameNoLive: `${FRAME_EN} — versions/index.json has no valid "live". ${FRAME_HINT_EN}`,
    // ds-resolve.mjs, the "@ds" Vite plugin (project language: the frame's error overlay and Claude's checks)
    dsNoLive: ({ root }) => `Can't resolve "@ds": no live version is known — ${root}/versions/index.json can't be read (or has no "live") and no versions/<version>/ folder has a version.json.`,
    // The \" in the two texts below gives the same text, but keeps the word import from being followed by a quote in
    // this file's source: the studio UI loads this file, and lib/vite-config.test.mjs reads that pattern in the UI's
    // sources as a package to pre-bundle.
    dsCssBlocked: ({ file, found }) => `CSS ${file} blocked: ${found} — in versions/ only @import \"tailwindcss\" or "./file.css" is allowed.`,
  },
  vi: {
    badVersionStatus: ({ status }) => `trạng thái không hợp lệ: ${status}`,
    versionIdInvalid: ({ id }) => `id phiên bản không hợp lệ: ${id}`,
    versionSourceMissing: ({ id }) => `không có phiên bản ${id}`,
    versionTitleMissing: "thiếu tên phiên bản",
    optionVersionMissing: ({ id }) => `không có phiên bản: ${id}`,
    optionNameMissing: "thiếu tên phương án",
    optionNoScreens: "chọn ít nhất một màn",
    optionScreenIdInvalid: ({ id }) => `id màn không hợp lệ: ${id}`,
    optionScreenIsOption: ({ id }) => `màn đã là phương án: ${id}`,
    optionScreenMissing: ({ id }) => `không có màn: ${id}`,
    optionNotOption: ({ id }) => `không phải phương án: ${id}`,
    optionMissing: ({ id }) => `không có phương án: ${id}`,
    optionMetaNotJson: ({ base }) => `File thông tin phải là JSON hợp lệ (phương án cần ${shapeVi(base)}).`,
    optionMetaNotObject: ({ base }) => `Phương án phải có ${shapeVi(base)} — không phải chữ trơn.`,
    optionMetaBadOf: ({ base }) => `option.of phải là màn chính "${base}". Dạng đúng: ${shapeVi(base)}.`,
    optionMetaBadName: ({ base }) => `option.name phải là tên ngắn của phương án. Dạng đúng: ${shapeVi(base)}.`,
    optionMetaBadStatus: ({ base }) => `option.status phải là "trying" (hoặc "adopted"). Dạng đúng: ${shapeVi(base)}.`,
    threadEntryInvalid: "entry không hợp lệ",
    threadVersionInvalid: "phiên bản không hợp lệ",
    threadTitleMissing: "thiếu tiêu đề",
    messageRoleInvalid: "role phải là user|claude",
    messageTooLong: "tin nhắn quá dài",
    messageTooManyMarks: "quá nhiều vùng khoanh",
    markInvalid: "vùng khoanh không hợp lệ",
    messageViewingOutside: "màn đang xem không thuộc luồng này",
    messageTooManyImages: ({ max }) => `tối đa ${max} ảnh mỗi tin`,
    messageImageInvalid: "ảnh đính kèm không hợp lệ",
    messageEmpty: "tin nhắn trống",
    markMissing: "không có vùng khoanh này",
    markAlreadyRemoved: "vùng khoanh đã bỏ",
    markNotRemoved: "vùng khoanh chưa bỏ",
    markRemovedRestoreFirst: "vùng khoanh đã bỏ — khôi phục trước khi vẽ lại",
    markActionInvalid: "thao tác phải là remove|restore|redraw",
    transcriptClaude: "Claude (bạn, lượt trước)",
    transcriptOnlyImages: "(chỉ gửi ảnh, không có chữ)",
    transcriptOnlyMarks: "(chỉ khoanh, không có chữ)",
    transcriptMarks: "Vùng khoanh kèm tin này:",
    transcriptImages: "Ảnh người dùng đính kèm tin này (dùng Read để xem từng ảnh):",
    transcriptImage: ({ n, path }) => `ảnh ${n}: ${path}`,
    transcriptMarkRemoved: ({ n }) => `[#${n}] đã bỏ (người dùng bỏ vùng này)`,
    transcriptMark: ({ n, scenario, viewport, x, y, w, h, texts }) =>
      `[#${n}] kịch bản ${scenario ?? "(mặc định)"} · ${viewport} · x=${x} y=${y} w=${w} h=${h}${texts ? ` · chữ: ${texts}` : ""}`,
    specOverview: "Tổng quan",
    frameUnreachable: ({ detail }) => `${FRAME_VI} — không hỏi được máy chủ xưởng (${detail}). ${FRAME_HINT_VI}`,
    frameServerError: ({ status, detail }) => `${FRAME_VI} — máy chủ xưởng trả lỗi ${status}${detail ? `: ${detail}` : ""}. ${FRAME_HINT_VI}`,
    frameUnreadable: `${FRAME_VI} — máy chủ xưởng trả dữ liệu không đọc được. ${FRAME_HINT_VI}`,
    frameNoLive: `${FRAME_VI} — versions/index.json chưa ghi "live" hợp lệ. ${FRAME_HINT_VI}`,
    dsNoLive: ({ root }) => `Không phân giải được "@ds": chưa biết phiên bản đang chạy — ${root}/versions/index.json không đọc được (hoặc thiếu "live") và chưa có thư mục versions/<phiên-bản>/ nào có version.json.`,
    dsCssBlocked: ({ file, found }) => `CSS ${file} bị chặn: ${found} — trong versions/ chỉ được @import \"tailwindcss\" hoặc "./tệp.css".`,
  },
};
export default DATA;

/**
 * Text of `key` in `lang` (that language → English → the key itself). The same lookup as lib/i18n.mjs translate,
 * without its Node imports: the libs shared with the studio UI (thread-core, spec-core, option-meta, frame-version)
 * run in the browser too.
 */
export function dataText(lang, key, params = {}) {
  const own = (d, k) => (d && Object.hasOwn(d, k) ? d[k] : undefined);
  const v = own(own(DATA, lang), key) ?? own(DATA.en, key);
  if (v === undefined) return key;
  return typeof v === "function" ? v(params ?? {}) : v;
}
