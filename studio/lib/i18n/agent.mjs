// Texts Claude reads in the studio (studio/lib/agent.mjs, agent-tools.mjs, checks.mjs, spec-lint.mjs): the system
// prompt, tool descriptions, tool results and check messages, the per-turn prompt. Picked by the PROJECT language
// (craft-table.json "language"), never by the viewer's — Claude replies in the language the person wrote in.
// The lint* entries are also read by the studio's editors (spec-lint.mjs runs in the browser too): the vocabulary
// follows the project's language (it describes the content), the issue text may follow the viewer's (uiLang).
// lintTerms / lintHttpCode are regular-expression sources, not prose: the words that count as jargon in each language.
// Shape (checked by lib/i18n.test.mjs): the same keys in en and vi; a value is a string or (params) => string.
// The vi texts are the studio's Vietnamese texts of earlier versions, word for word.

const plural = (n, one, many) => (n === 1 ? one : many);
const enScenario = (s) => (s ? `scenario ${s}` : "no scenario");
const viScenario = (s) => (s ? `kịch bản ${s}` : "không kịch bản");

export default {
  en: {
    // ── agent.mjs: system prompt, Stop hook, per-turn prompt ──
    systemPrompt: ({ name, description, sourceRoots, sourceLabel, topics }) => {
      const about = description ? ` — ${description}` : "";
      const src = sourceRoots ? ` (${sourceRoots} is the source code of ${sourceLabel} — the real app, read-only)` : "";
      return `You are Claude, the design assistant in the craft-table design studio of the project ${name}${about} — where the project owner and Claude design screens BEFORE they are coded. Each screen is a React board (with several scenarios) plus screen info and a spec with 2 tabs (Behavior, Technical).

You work only through the studio's tools, already locked to the version and thread of the message. How to work:
1. Explore first, don't guess: list (screens, scenarios, files) → read_thread when you need earlier messages → view_region / view_image for marks and attached images → view_frame to see how the screen looks now → read / search the relevant files${src}.
2. Before working on a topic, read the rules for it: ${topics}.
3. Edit with edit (the old text must be unique) / write. Change only what you were asked to.
4. Check before you reply: check typecheck after editing .tsx, check lint after editing descriptions/scenarios/the Behavior tab, check spec after editing a spec; view_frame the same scenario again to see the result. If errors remain, keep fixing until it is clean.
5. When there are several ways to go, name each one (Option A — <short name>, Option B — …), state the trade-offs and recommend 1; when the person needs to decide, ask clearly and STOP — don't do it yourself.

Reply in the language the person wrote in (English when unclear), in short markdown (bullets, **bold**), straight to the point: what you did (which files), how you checked, what the person needs to decide. Point at places on a frame with @mark(<scenario|->, <desktop|mobile>, x, y, w, h) — get the coordinates with locate.`;
    },
    stopUnchecked: ({ steps }) => `Not checked since your last edit: ${steps}. Do these steps before you reply; if errors remain, fix only the ones in files you edited (errors on other screens are not this turn's job — mention them in your reply).`,
    promptHead: ({ thread, version, entry, title, before }) => `Thread ${thread} · version ${version} · screen ${entry} ("${title}")${before > 0 ? ` · ${before} earlier ${plural(before, "message", "messages")} (read_thread to see them)` : ""}.`,
    promptViewing: ({ main, entry }) => `The person is viewing the ${main ? "main screen" : "option"} ${entry} — work on this screen by default.`,
    promptMarkChanges: ({ changes }) => `Earlier marks changed since the last turn: ${changes.map((c) => (c.change === "removed" ? `#${c.n} removed (ignore it)` : `#${c.n} redrawn → view_region(${c.n})`)).join(", ")}.`,
    promptMessage: ({ author, text }) => `New message — ${author}:\n${text || "(no text)"}`,
    promptMark: ({ n, scenario, viewport, removed }) => (removed ? `Mark #${n}: removed` : `Mark #${n}: ${enScenario(scenario)} · ${viewport} → view_region(${n})`),
    promptImage: ({ n, id }) => `Image ${n} → view_image("${id}")`,

    // ── agent-tools.mjs: tool descriptions ──
    toolList: "List things to find your way BEFORE reading: screens (every screen of the version), scenarios (the scenarios of a screen), files (the files of a screen: board, screen info, the 2 spec tabs), system (design system files), threads (the screen's threads).",
    paramEntry: "screen id, e.g. screens/orders/list — defaults to the thread's screen",
    toolRead: ({ max, version, srcArea, label }) => `Read a file (with line numbers), at most ${max} lines at a time. path: "boards/…" or "system/…" in version ${version}${srcArea ? `, or ${srcArea} (source code of ${label} — the real app, read-only)` : ""}.`,
    toolSearch: ({ max, label }) => `Find TEXT (case-insensitive, not a regex) → "file:line: content", at most ${max} results. in: version (default, the whole version)${label ? ` or source (source code of ${label})` : ""}. glob: filter file names, e.g. "*.tsx".`,
    toolReadThread: ({ page }) => `Read the messages of this thread (${page} at a time): author, text, mark ids (#n — see them with view_region) and attached images (see them with view_image).`,
    toolViewFrame: "See the frame image of one scenario of a screen (a real image of the running board). part: top = one screen (default), full = the whole page (at most 2000px tall). Use it to understand the screen BEFORE editing and to check yourself AFTER editing.",
    paramScenario: "scenario id; empty or '-' = no scenario",
    toolViewRegion: "See exactly the area the person marked (#n in the thread): an image with a red outline + the text inside the area.",
    toolViewImage: "See an image the person attached in this thread (take the id from the message or from read_thread).",
    toolLocate: "Find the coordinates of the element holding a text on the frame → an @mark(...) line to paste straight into your reply to point at it.",
    toolEdit: ({ version }) => `Edit a file by replacing one passage: old must appear EXACTLY ONCE (add context if needed). Only "boards/…" or "system/…" of version ${version}.`,
    toolWrite: ({ version }) => `Write a whole file (create it or replace all of it). Only "boards/…" or "system/…" of version ${version}; extensions .tsx .ts .css .md .json.`,
    toolCheck: "Check after editing (MUST be clean before you reply): typecheck (after editing .tsx), lint (the plain-language rule — after editing names/descriptions/scenarios/the Behavior tab), spec (the spec page: diagrams + embedded code — after editing .md; returns an image too).",
    toolRules: ({ topics }) => `Read the detailed rules of a topic BEFORE working on that topic: ${topics}.`,
    /** Name of the mark syntax Claude writes, @<markName>(…) — both @mark and @khoanh are always parsed (thread-core.mjs). */
    markName: "mark",

    // ── agent-tools.mjs: tool results and errors ──
    outOfScope: ({ version, srcArea }) => `Out of scope: you can only read "boards/…", "system/…" of version ${version}${srcArea ? ` or ${srcArea}` : ""}.`,
    cssBlocked: ({ found }) => `Not allowed in CSS: ${found} (Tailwind would load/run other files on the server). Only @import "tailwindcss" or "./file.css".`,
    listScreen: ({ id, title, scenarios, option }) => `${id} — ${title} (${scenarios} ${plural(scenarios, "scenario", "scenarios")})${option != null ? ` · option "${option}"` : ""}`,
    noScreens: "(no screens yet)",
    noScenarios: "(the screen has no scenarios — use '-')",
    listThread: ({ id, title, status, messages }) => `${id} — ${title} (${status}, ${messages} ${plural(messages, "message", "messages")})`,
    noThreads: "(no threads yet)",
    noScreen: ({ entry }) => `No screen "${entry}".`,
    noScreenIn: ({ entry, version }) => `No screen "${entry}" in ${version}.`,
    noScreenUseList: ({ entry, version }) => `No screen "${entry}" in ${version} — use list screens.`,
    noFile: ({ path }) => `No file ${path}.`,
    moreLines: ({ left, from }) => `… ${left} more ${plural(left, "line", "lines")} — read on with from=${from}`,
    noSource: "The project has no app source code set up (craft-table.json → source).",
    notFound: ({ text }) => `No match for "${text}".`,
    moreResults: ({ left }) => `… ${left} more ${plural(left, "result", "results")} — narrow the pattern/glob`,
    threadUnreadable: "Could not read the thread.",
    threadMessage: ({ index, who, text, refs, images }) => {
      const rs = refs.map((r) => (r.removed ? `#${r.n} (removed)` : `#${r.n} (${enScenario(r.scenario)} · ${r.viewport}${r.entry ? ` · on ${r.entry}` : ""}${r.redrawn ? " · redrawn" : ""})`));
      const im = images.map((x, k) => `image ${k + 1}: ${x}`);
      return `[${index}] ${who}:\n${text || "(no text)"}${rs.length ? `\nMarks: ${rs.join(", ")}` : ""}${im.length ? `\nImages: ${im.join(", ")}` : ""}`;
    },
    noMoreMessages: "(no more messages)",
    moreMessages: ({ left, from }) => `… ${left} more ${plural(left, "message", "messages")} — read on with from=${from}`,
    frameCaption: ({ entry, scenario, viewport, height, errors }) => `Frame ${entry}${scenario && scenario !== "-" ? ` · ${scenario}` : ""} · ${viewport}${height ? ` · page ${height}px tall` : ""}${errors?.length ? `\nJS ERRORS: ${errors.join(" | ")}` : ""}`,
    noMark: ({ n }) => `The thread has no mark #${n} — see read_thread.`,
    markRemoved: ({ n }) => `Mark #${n} was removed — the person no longer wants this area acted on.`,
    regionCaption: ({ n, scenario, viewport, x, y, w, h, texts }) => `Area #${n}: ${enScenario(scenario)} · ${viewport} · x=${x} y=${y} width ${w} height ${h}\nText in the area: ${texts.join(" · ") || "(none)"}`,
    imageNotInThread: ({ id }) => `Image "${id}" is not part of this thread.`,
    imageGone: "The image is no longer on the server.",
    imageShrunk: ({ mb }) => `Original image ${mb} MB — shrunk (long side at most 1568 px) to send it.`,
    imageTooBig: ({ mb, error }) => `The image (${mb} MB) is too large and could not be shrunk: ${error}`,
    cannotEdit: ({ path, version }) => `Cannot edit "${path}": only boards/… or system/… (.tsx .ts .css .md .json) of ${version}.`,
    noFileUseWrite: ({ path }) => `No file ${path} — create it with write.`,
    editAmbiguous: ({ count }) => `The passage to replace appears ${count} times — add context to make it unique.`,
    editNotFound: "The passage to replace was not found — read the file again.",
    edited: ({ path }) => `Edited ${path}.`,
    cannotWrite: ({ path, version }) => `Cannot write "${path}": only boards/… or system/… (.tsx .ts .css .md .json) of ${version}.`,
    written: ({ path, lines }) => `Wrote ${path} (${lines} ${plural(lines, "line", "lines")}).`,
    typecheckClean: "✓ typecheck clean",
    lintOff: "✓ the project has not turned on the plain-language rule — nothing to check",
    lintClean: "✓ descriptions and the Behavior tab are all plain words",
    lintFailed: ({ count, issues }) => `✗ ${count} ${plural(count, "place is", "places are")} not plain words — move the technical part to the Technical tab:\n${issues}`,
    noSpecFile: ({ path }) => `No ${path} yet.`,
    specReport: ({ diagrams, badDiagrams, embeds, badEmbeds, rules, errors }) => `diagrams: ${diagrams} drawn${badDiagrams.length ? `, ${badDiagrams.length} ${plural(badDiagrams.length, "ERROR", "ERRORS")}: ${badDiagrams.join(" | ")}` : ""} · embedded code: ${embeds}${badEmbeds.length ? `, ${badEmbeds.length} BROKEN: ${badEmbeds.join(" | ")}` : ""} · rules: ${rules}${errors.length ? ` · JS ERRORS: ${errors.join(" | ")}` : ""}`,
    unknownTopic: ({ topics }) => `Topics: ${topics}.`,

    // ── design turns: a conversation about the WHOLE design of a version (agent-tools-design.mjs, agent.mjs) ──
    designSystemPrompt: ({ name, description, sourceRoots, sourceLabel, topics, sandbox }) => {
      const about = description ? ` — ${description}` : "";
      const src = sourceRoots ? ` (${sourceRoots} is the source code of ${sourceLabel} — the real app, read-only)` : "";
      return `You are Claude, the design assistant in the craft-table design studio of the project ${name}${about}. This is a WHOLE-DESIGN conversation: your job is the whole design of one version — every screen, the design system, the specs — not one screen. The person may ask for a change that reaches everything (denser spacing, another type scale, a colour, a rename across all screens), for an audit, or for a restructure.

You work only through the studio's tools, already locked to the version of the thread. How to work:
1. Explore first, don't guess: list (screens, scenarios, files, system) → read / search → view_frame or browse to see how it looks now${src}. The message says which screen the person is looking at, if any — a hint of what they mean, not a limit.
2. Before working on a topic, read the rules for it: ${topics}.
3. Take the cheapest tool that is exact: the design system (system/: tokens, components) when one change there reaches every screen; replace for a pattern across many files (dry run first, then dry_run false); ${sandbox ? "run for a change that needs real code (a script that computes new values, renames files, generates boards); " : ""}edit / write for single changes. Change only what the task needs — but go through ALL the screens it needs, never stop after the first few.
4. Look at the result, don't assume: browse the screens you changed (all: true goes over the whole version and reports what is broken), look at pictures of a few important ones, and run check typecheck. If errors remain, keep fixing until it is clean. Work through a long job in steps.
5. When there are several ways to go, name each one (Option A — <short name>, Option B — …), state the trade-offs and recommend 1; when the person needs to decide, ask clearly and STOP — don't do it yourself.

Reply in the language the person wrote in (English when unclear), in short markdown (bullets, **bold**), straight to the point: what you changed (which files, how many), how you checked (what the pictures and the report showed), what the person needs to decide. Point at places on a frame with @mark(<scenario|->, <desktop|mobile>, x, y, w, h) only for the screen the person is looking at.`;
    },
    promptHeadDesign: ({ thread, version, before }) => `Thread ${thread} · version ${version} · the whole design${before > 0 ? ` · ${before} earlier ${plural(before, "message", "messages")} (read_thread to see them)` : ""}.`,
    promptViewingDesign: ({ entry }) => `The person is looking at ${entry} (a screen of this version) — a hint of what they mean, not a limit on your work.`,
    toolReplace: ({ version, max }) => `Find and replace across MANY files of version ${version} at once — for a change that reaches the whole design (a class, a value, a pattern). pattern: plain text, or a JavaScript regular expression when regex is true (use $1 … in replacement); ignore_case; paths: a glob over "boards/…" and "system/…" (default: everything), e.g. "boards/**/*.tsx". Only editable files (.tsx .ts .css .md .json) are looked at, at most ${max} files. It is a DRY RUN unless dry_run is false: it lists the matches per file with the lines before / after and writes nothing — look, then call again with dry_run false. All or nothing: when the write rules refuse any file, nothing is written. Tip: anchor patterns (\\b) — "p-3" also matches inside "gap-3".`,
    toolBrowse: ({ maxFrames }) => `Look at the real screens in Chrome (Puppeteer), many at once. frames: up to ${maxFrames} of { entry, scenario, viewport, theme } — each comes back as a picture with its height and every problem the page reported. all: true goes over every scenario of every screen (viewport: desktop, mobile or both; entries narrows it with a glob on screen ids): no pictures, a report of what is broken — use it after a bulk change. eval: a JavaScript expression run INSIDE each page (e.g. "document.querySelectorAll('button').length", or a measurement of a size); its JSON result is reported per frame.`,
    toolRun: ({ version, backend, isolated, max }) => `Run a shell command (node, python, sed … whatever the machine has) in a sandbox (${backend}) on a COPY of boards/ and system/ of version ${version} — for a change replace cannot say: a script that computes new values, renames files, generates boards. The command starts in a folder holding boards/ and system/; what it changes there is checked by the same write rules as edit / write and lands in the version when it ends (refused files and conflicts are listed). ${isolated ? "No network." : "WARNING: this sandbox is NOT isolated from the network."} There is no browser here — look at screens with browse. timeout_s: at most ${max}.`,
    replaceBadPattern: ({ error }) => `The pattern does not work: ${error}`,
    replaceNoFiles: ({ paths }) => `No editable file matches ${paths} — only .tsx .ts .css .md .json under boards/ and system/.`,
    replaceNoMatch: ({ files }) => `No match in ${files} ${plural(files, "file", "files")}.`,
    replaceTooMany: ({ max }) => `More than ${max} files match — narrow it down with paths.`,
    replaceDry: ({ total, files, list, more }) => `Dry run — nothing was written. ${total} ${plural(total, "match", "matches")} in ${files} ${plural(files, "file", "files")}:\n${list}${more > 0 ? `\n… and ${more} more ${plural(more, "file", "files")}` : ""}\nTo apply, call again with dry_run false.`,
    replaceWrote: ({ total, files, list }) => `wrote: ${list}\n${total} ${plural(total, "replacement", "replacements")} in ${files} ${plural(files, "file", "files")}. Now look at the result (browse, check typecheck).`,
    replaceRefused: ({ list }) => `Nothing was written. The write rules refuse:\n${list}`,
    browseNoFrames: "Give frames, or all: true.",
    browseTooMany: ({ max }) => `At most ${max} frames at a time — use all: true for a report over everything.`,
    browseLine: ({ entry, scenario, viewport, height, problems, value }) => `${entry} · ${scenario ?? "-"} · ${viewport} — ${height} px${problems.length ? ` · ERRORS: ${problems.join("; ")}` : ""}${value !== undefined ? ` · eval: ${value}` : ""}`,
    browseSummary: ({ frames, broken }) => `${frames} ${plural(frames, "frame", "frames")} looked at · ${broken} broken`,
    browseNoPictures: ({ max }) => `(pictures are left out beyond ${max} frames)`,
    runExit: ({ code }) => `exit code ${code}`,
    runTimedOut: ({ seconds }) => `timed out after ${seconds} s — the command was killed and NOTHING was applied`,
    runLanded: ({ list }) => `landed: ${list}`,
    runLandedNone: "landed: nothing",
    runDeleted: ({ list }) => `deleted: ${list}`,
    runRefused: ({ list }) => `refused:\n${list}`,
    runConflicts: ({ list }) => `conflicts (the person changed these meanwhile — their version was kept): ${list}`,
    runCut: "(output cut)",

    // ── checks.mjs ──
    tscFailed: ({ project, output }) => `✗ tsc errors (${project}):\n${output}`,
    tscClean: ({ studio, version }) => `✓ tsc clean (${studio ? "studio + " : ""}${version})`,

    // ── spec-lint.mjs (plain-language rule) ──
    lintCodeBlock: "code block (the Behavior tab holds no code)",
    lintTerms: "APIs?|endpoints?|props|params?|payloads?|JSON|SQL|DB|databases?|schemas?|migrations?|null|undefined|boolean|timestamps?|debounced?|HTTPS?|frontend|backend|middleware|webhooks?|regex|enums?|UUIDs?|CSS|HTML|DOM|SVG|stack trace|re-?render(?:s|ed|ing)?",
    lintHttpCode: String.raw`\b(?:returns?|returned|error(?:\s+code)?|status(?:\s+code)?|HTTP|server)\s*([2-5]\d{2})\b`,
  },
  vi: {
    // ── agent.mjs: system prompt, Stop hook, per-turn prompt ──
    systemPrompt: ({ name, description, sourceRoots, sourceLabel, topics }) => {
      const about = description ? ` — ${description}` : "";
      const src = sourceRoots ? ` (${sourceRoots} là mã nguồn ${sourceLabel} — app thật, chỉ đọc)` : "";
      return `Bạn là Claude, trợ lý thiết kế trong xưởng thiết kế craft-table của dự án ${name}${about} — nơi chủ dự án và Claude cùng thiết kế màn hình TRƯỚC khi code. Mỗi màn là một bản vẽ React (nhiều kịch bản) kèm thông tin màn và đặc tả 2 tab (Hành vi, Kỹ thuật).

Bạn chỉ làm việc qua các công cụ xưởng, đã khoá sẵn theo phiên bản và luồng của tin nhắn. Cách làm:
1. Mò trước, đừng đoán: list (màn, kịch bản, file) → read_thread khi cần tin cũ → view_region / view_image cho vùng khoanh, ảnh đính kèm → view_frame để thấy màn đang trông thế nào → read / search file liên quan${src}.
2. Trước khi sửa việc thuộc chủ đề nào thì đọc rules của chủ đề đó: ${topics}.
3. Sửa bằng edit (đoạn cũ phải duy nhất) / write. Chỉ sửa đúng việc được nhờ.
4. Tự kiểm rồi mới trả lời: check typecheck sau khi sửa .tsx, check lint sau khi sửa mô tả/kịch bản/tab Hành vi, check spec sau khi sửa đặc tả; view_frame lại đúng kịch bản để xem kết quả. Còn lỗi thì sửa tiếp, lặp tới khi sạch.
5. Có nhiều hướng thì đặt tên từng cái (Phương án A — <tên ngắn>, Phương án B — …), nêu đánh đổi + đề xuất 1; cần người dùng quyết thì hỏi rõ và DỪNG, đừng tự làm.

Trả lời bằng đúng ngôn ngữ người dùng đã viết (không rõ thì dùng tiếng Việt), bằng markdown gọn (gạch đầu dòng, **đậm**), ngắn, đi thẳng vào việc: đã làm gì (file nào), kiểm thế nào, điều cần người dùng quyết. Chỉ chỗ trên khung bằng @khoanh(<kịch-bản|->, <desktop|mobile>, x, y, w, h) — lấy toạ độ bằng locate.`;
    },
    stopUnchecked: ({ steps }) => `Chưa tự kiểm sau lần sửa cuối: ${steps}. Làm các bước này rồi mới trả lời; còn lỗi thì chỉ sửa lỗi nằm ở file bạn đã sửa (lỗi ở màn khác không phải việc của lượt này — nêu trong câu trả lời).`,
    promptHead: ({ thread, version, entry, title, before }) => `Luồng ${thread} · phiên bản ${version} · màn ${entry} ("${title}")${before > 0 ? ` · ${before} tin trước (read_thread để xem)` : ""}.`,
    promptViewing: ({ main, entry }) => `Người dùng đang xem ${main ? "màn chính" : "phương án"} ${entry} — mặc định làm trên màn này.`,
    promptMarkChanges: ({ changes }) => `Khoanh cũ đã đổi từ lượt trước: ${changes.map((c) => (c.change === "removed" ? `#${c.n} đã bỏ (bỏ qua)` : `#${c.n} vẽ lại → view_region(${c.n})`)).join(", ")}.`,
    promptMessage: ({ author, text }) => `Tin mới — ${author}:\n${text || "(không có chữ)"}`,
    promptMark: ({ n, scenario, viewport, removed }) => (removed ? `Vùng khoanh #${n}: đã bỏ` : `Vùng khoanh #${n}: ${viScenario(scenario)} · ${viewport} → view_region(${n})`),
    promptImage: ({ n, id }) => `Ảnh ${n} → view_image("${id}")`,

    // ── agent-tools.mjs: tool descriptions ──
    toolList: "Liệt kê để định hướng TRƯỚC khi đọc: screens (mọi màn của phiên bản), scenarios (kịch bản của một màn), files (file của một màn: bản vẽ, thông tin, 2 tab đặc tả), system (file design system), threads (các luồng của màn).",
    paramEntry: "id màn, vd screens/orders/list — mặc định màn của luồng",
    toolRead: ({ max, version, srcArea, label }) => `Đọc file (có số dòng), tối đa ${max} dòng mỗi lần. path: "boards/…" hoặc "system/…" trong phiên bản ${version}${srcArea ? `, hoặc ${srcArea} (mã nguồn ${label} — app thật, chỉ đọc)` : ""}.`,
    toolSearch: ({ max, label }) => `Tìm CHỮ (không phân biệt hoa thường, không phải regex) → "file:dòng: nội dung", tối đa ${max} kết quả. in: version (mặc định, cả phiên bản)${label ? ` hoặc source (mã nguồn ${label})` : ""}. glob: lọc tên file, vd "*.tsx".`,
    toolReadThread: ({ page }) => `Đọc các tin của luồng này (${page} tin mỗi lần): tác giả, chữ, mã vùng khoanh (#n — xem bằng view_region) và ảnh đính kèm (xem bằng view_image).`,
    toolViewFrame: "Xem ảnh khung một kịch bản của màn (ảnh thật của bản vẽ đang chạy). part: top = một màn hình (mặc định), full = cả trang (cao tối đa 2000px). Dùng để hiểu màn TRƯỚC khi sửa và tự kiểm SAU khi sửa.",
    paramScenario: "id kịch bản; bỏ trống hoặc '-' = không kịch bản",
    toolViewRegion: "Xem đúng vùng người dùng khoanh (#n trong luồng): ảnh có viền đỏ + chữ nằm trong vùng.",
    toolViewImage: "Xem ảnh người dùng đính kèm trong luồng này (id lấy từ tin nhắn hoặc read_thread).",
    toolLocate: "Tìm toạ độ phần tử chứa chữ trên khung → dòng @khoanh(...) dán thẳng vào câu trả lời để chỉ chỗ.",
    toolEdit: ({ version }) => `Sửa file bằng cách thay một đoạn: old phải xuất hiện ĐÚNG MỘT lần (thêm ngữ cảnh nếu cần). Chỉ "boards/…" hoặc "system/…" của phiên bản ${version}.`,
    toolWrite: ({ version }) => `Ghi cả file (tạo mới hoặc thay toàn bộ). Chỉ "boards/…" hoặc "system/…" của phiên bản ${version}; đuôi .tsx .ts .css .md .json.`,
    toolCheck: "Kiểm sau khi sửa (PHẢI sạch trước khi trả lời): typecheck (sau khi sửa .tsx), lint (luật lời thường — sau khi sửa tên/mô tả/kịch bản/tab Hành vi), spec (trang đặc tả: sơ đồ + code nhúng — sau khi sửa .md; trả kèm ảnh).",
    toolRules: ({ topics }) => `Đọc luật chi tiết theo chủ đề TRƯỚC khi làm việc thuộc chủ đề đó: ${topics}.`,
    markName: "khoanh",

    // ── agent-tools.mjs: tool results and errors ──
    outOfScope: ({ version, srcArea }) => `Ngoài phạm vi: chỉ đọc "boards/…", "system/…" của phiên bản ${version}${srcArea ? ` hoặc ${srcArea}` : ""}.`,
    cssBlocked: ({ found }) => `Không được dùng trong CSS: ${found} (Tailwind sẽ nạp/chạy file khác trong máy chủ). Chỉ @import "tailwindcss" hoặc "./tệp.css".`,
    listScreen: ({ id, title, scenarios, option }) => `${id} — ${title} (${scenarios} kịch bản)${option != null ? ` · phương án "${option}"` : ""}`,
    noScreens: "(chưa có màn)",
    noScenarios: "(màn không chia kịch bản — dùng '-')",
    listThread: ({ id, title, status, messages }) => `${id} — ${title} (${status}, ${messages} tin)`,
    noThreads: "(chưa có luồng)",
    noScreen: ({ entry }) => `Không có màn "${entry}".`,
    noScreenIn: ({ entry, version }) => `Không có màn "${entry}" trong ${version}.`,
    noScreenUseList: ({ entry, version }) => `Không có màn "${entry}" trong ${version} — dùng list screens.`,
    noFile: ({ path }) => `Không có file ${path}.`,
    moreLines: ({ left, from }) => `… còn ${left} dòng — đọc tiếp với from=${from}`,
    noSource: "Dự án chưa khai mã nguồn app (craft-table.json → source).",
    notFound: ({ text }) => `Không thấy "${text}".`,
    moreResults: ({ left }) => `… còn ${left} kết quả — thu hẹp pattern/glob`,
    threadUnreadable: "Không đọc được luồng.",
    threadMessage: ({ index, who, text, refs, images }) => {
      const rs = refs.map((r) => (r.removed ? `#${r.n} (đã bỏ)` : `#${r.n} (${viScenario(r.scenario)} · ${r.viewport}${r.entry ? ` · trên ${r.entry}` : ""}${r.redrawn ? " · đã vẽ lại" : ""})`));
      const im = images.map((x, k) => `ảnh ${k + 1}: ${x}`);
      return `[${index}] ${who}:\n${text || "(không có chữ)"}${rs.length ? `\nVùng khoanh: ${rs.join(", ")}` : ""}${im.length ? `\nẢnh: ${im.join(", ")}` : ""}`;
    },
    noMoreMessages: "(hết tin)",
    moreMessages: ({ left, from }) => `… còn ${left} tin — đọc tiếp với from=${from}`,
    frameCaption: ({ entry, scenario, viewport, height, errors }) => `Khung ${entry}${scenario && scenario !== "-" ? ` · ${scenario}` : ""} · ${viewport}${height ? ` · trang cao ${height}px` : ""}${errors?.length ? `\nLỖI JS: ${errors.join(" | ")}` : ""}`,
    noMark: ({ n }) => `Luồng không có vùng khoanh #${n} — xem read_thread.`,
    markRemoved: ({ n }) => `Vùng khoanh #${n} đã bị bỏ — người dùng không cần làm theo vùng này nữa.`,
    regionCaption: ({ n, scenario, viewport, x, y, w, h, texts }) => `Vùng #${n}: ${viScenario(scenario)} · ${viewport} · x=${x} y=${y} rộng ${w} cao ${h}\nChữ trong vùng: ${texts.join(" · ") || "(không có)"}`,
    imageNotInThread: ({ id }) => `Ảnh "${id}" không thuộc luồng này.`,
    imageGone: "Ảnh không còn trên máy chủ.",
    imageShrunk: ({ mb }) => `Ảnh gốc ${mb} MB — đã thu nhỏ (cạnh dài tối đa 1568 px) để gửi.`,
    imageTooBig: ({ mb, error }) => `Ảnh ${mb} MB quá lớn và không thu nhỏ được: ${error}`,
    cannotEdit: ({ path, version }) => `Không được sửa "${path}": chỉ boards/… hoặc system/… (.tsx .ts .css .md .json) của ${version}.`,
    noFileUseWrite: ({ path }) => `Không có file ${path} — tạo mới bằng write.`,
    editAmbiguous: ({ count }) => `Đoạn cần thay xuất hiện ${count} lần — thêm ngữ cảnh cho duy nhất.`,
    editNotFound: "Không thấy đoạn cần thay — read lại file.",
    edited: ({ path }) => `Đã sửa ${path}.`,
    cannotWrite: ({ path, version }) => `Không được ghi "${path}": chỉ boards/… hoặc system/… (.tsx .ts .css .md .json) của ${version}.`,
    written: ({ path, lines }) => `Đã ghi ${path} (${lines} dòng).`,
    typecheckClean: "✓ typecheck sạch",
    lintOff: "✓ dự án không bật luật lời thường — không có gì để kiểm",
    lintClean: "✓ mô tả + tab Hành vi đều là lời thường",
    lintFailed: ({ count, issues }) => `✗ ${count} chỗ chưa phải lời thường — chuyển phần kỹ thuật sang tab Kỹ thuật:\n${issues}`,
    noSpecFile: ({ path }) => `Chưa có ${path}.`,
    specReport: ({ diagrams, badDiagrams, embeds, badEmbeds, rules, errors }) => `sơ đồ: ${diagrams} vẽ được${badDiagrams.length ? `, ${badDiagrams.length} LỖI: ${badDiagrams.join(" | ")}` : ""} · code nhúng: ${embeds}${badEmbeds.length ? `, ${badEmbeds.length} HỎNG: ${badEmbeds.join(" | ")}` : ""} · luật: ${rules}${errors.length ? ` · LỖI JS: ${errors.join(" | ")}` : ""}`,
    unknownTopic: ({ topics }) => `Chủ đề có: ${topics}.`,

    // ── lượt toàn thiết kế: hội thoại về TOÀN BỘ thiết kế của một phiên bản (agent-tools-design.mjs, agent.mjs) ──
    designSystemPrompt: ({ name, description, sourceRoots, sourceLabel, topics, sandbox }) => {
      const about = description ? ` — ${description}` : "";
      const src = sourceRoots ? ` (${sourceRoots} là mã nguồn của ${sourceLabel} — app thật, chỉ đọc)` : "";
      return `Bạn là Claude, trợ lý thiết kế trong studio craft-table của dự án ${name}${about}. Đây là hội thoại về TOÀN BỘ thiết kế: việc của bạn là cả thiết kế của một phiên bản — mọi màn, design system, các đặc tả — chứ không phải một màn. Người dùng có thể nhờ một thay đổi chạm tới mọi thứ (khoảng cách chặt hơn, thang chữ khác, đổi màu, đổi tên ở mọi màn), nhờ rà soát, hoặc nhờ cấu trúc lại.

Bạn chỉ làm việc qua các công cụ của studio, đã khoá vào phiên bản của luồng. Cách làm:
1. Khám phá trước, đừng đoán: list (screens, scenarios, files, system) → read / search → view_frame hoặc browse để xem bây giờ trông thế nào${src}. Tin nhắn cho biết người dùng đang xem màn nào (nếu có) — đó là gợi ý họ muốn nói gì, không phải giới hạn.
2. Trước khi làm một chủ đề, đọc luật của nó: ${topics}.
3. Chọn công cụ rẻ nhất mà vẫn chính xác: design system (system/: token, component) khi một thay đổi ở đó chạm tới mọi màn; replace cho một mẫu trên nhiều file (chạy thử trước, rồi dry_run false); ${sandbox ? "run cho thay đổi cần mã thật (script tính giá trị mới, đổi tên file, sinh bản vẽ); " : ""}edit / write cho thay đổi lẻ. Chỉ đổi những gì việc cần — nhưng đi hết MỌI màn mà việc cần, đừng dừng sau vài màn đầu.
4. Nhìn kết quả, đừng giả định: browse các màn đã sửa (all: true đi hết cả phiên bản và báo cái gì hỏng), xem ảnh vài màn quan trọng, và chạy check typecheck. Còn lỗi thì sửa tiếp đến khi sạch. Việc dài thì làm từng bước.
5. Có nhiều hướng thì gọi tên từng hướng (Phương án A — <tên ngắn>, Phương án B — …), nêu đánh đổi và đề xuất 1; cần người dùng quyết thì hỏi rõ rồi DỪNG — đừng tự làm.

Trả lời bằng ngôn ngữ người dùng viết (không rõ thì tiếng Anh), markdown ngắn (gạch đầu dòng, **đậm**), đi thẳng vào việc: đã đổi gì (file nào, bao nhiêu), đã kiểm tra thế nào (ảnh và báo cáo cho thấy gì), người dùng cần quyết gì. Chỉ trỏ vào khung bằng @khoanh(<kịch bản|->, <desktop|mobile>, x, y, w, h) trên màn người dùng đang xem.`;
    },
    promptHeadDesign: ({ thread, version, before }) => `Luồng ${thread} · phiên bản ${version} · toàn bộ thiết kế${before > 0 ? ` · ${before} tin trước (read_thread để xem)` : ""}.`,
    promptViewingDesign: ({ entry }) => `Người dùng đang xem ${entry} (một màn của phiên bản này) — gợi ý họ muốn nói gì, không giới hạn việc của bạn.`,
    toolReplace: ({ version, max }) => `Tìm và thay trên NHIỀU file của phiên bản ${version} cùng lúc — cho thay đổi chạm tới cả thiết kế (một class, một giá trị, một mẫu). pattern: chữ thường, hoặc biểu thức chính quy JavaScript khi regex là true (dùng $1 … trong replacement); ignore_case; paths: glob trên "boards/…" và "system/…" (mặc định: tất cả), ví dụ "boards/**/*.tsx". Chỉ nhìn file sửa được (.tsx .ts .css .md .json), tối đa ${max} file. Mặc định là CHẠY THỬ trừ khi dry_run là false: liệt kê chỗ khớp theo file với dòng trước / sau và không ghi gì — xem rồi gọi lại với dry_run false. Hoặc cả hai hoặc không: luật ghi từ chối file nào thì không ghi gì cả. Mẹo: neo mẫu (\\b) — "p-3" cũng khớp trong "gap-3".`,
    toolBrowse: ({ maxFrames }) => `Xem các màn thật trong Chrome (Puppeteer), nhiều màn cùng lúc. frames: tối đa ${maxFrames} khung { entry, scenario, viewport, theme } — mỗi khung trả về ảnh cùng chiều cao và mọi vấn đề trang báo. all: true đi hết mọi kịch bản của mọi màn (viewport: desktop, mobile hoặc both; entries thu hẹp bằng glob trên id màn): không ảnh, chỉ báo cáo cái gì hỏng — dùng sau một thay đổi hàng loạt. eval: một biểu thức JavaScript chạy BÊN TRONG mỗi trang (ví dụ "document.querySelectorAll('button').length", hoặc đo một kích thước); kết quả JSON được báo theo từng khung.`,
    toolRun: ({ version, backend, isolated, max }) => `Chạy một lệnh shell (node, python, sed … máy có gì dùng nấy) trong sandbox (${backend}) trên BẢN SAO của boards/ và system/ của phiên bản ${version} — cho thay đổi replace không diễn đạt được: script tính giá trị mới, đổi tên file, sinh bản vẽ. Lệnh bắt đầu trong thư mục có boards/ và system/; thứ nó đổi ở đó được kiểm bằng cùng luật ghi như edit / write và đổ vào phiên bản khi lệnh xong (file bị từ chối và xung đột được liệt kê). ${isolated ? "Không có mạng." : "CẢNH BÁO: sandbox này KHÔNG cách ly khỏi mạng."} Ở đây không có trình duyệt — xem màn bằng browse. timeout_s: tối đa ${max}.`,
    replaceBadPattern: ({ error }) => `Mẫu không chạy được: ${error}`,
    replaceNoFiles: ({ paths }) => `Không có file sửa được nào khớp ${paths} — chỉ .tsx .ts .css .md .json dưới boards/ và system/.`,
    replaceNoMatch: ({ files }) => `Không chỗ nào khớp trong ${files} file.`,
    replaceTooMany: ({ max }) => `Hơn ${max} file khớp — thu hẹp bằng paths.`,
    replaceDry: ({ total, files, list, more }) => `Chạy thử — chưa ghi gì. ${total} chỗ khớp trong ${files} file:\n${list}${more > 0 ? `\n… và ${more} file nữa` : ""}\nMuốn áp dụng, gọi lại với dry_run false.`,
    replaceWrote: ({ total, files, list }) => `wrote: ${list}\n${total} chỗ đã thay trong ${files} file. Giờ xem kết quả (browse, check typecheck).`,
    replaceRefused: ({ list }) => `Chưa ghi gì. Luật ghi từ chối:\n${list}`,
    browseNoFrames: "Cho frames, hoặc all: true.",
    browseTooMany: ({ max }) => `Mỗi lần tối đa ${max} khung — dùng all: true để báo cáo trên tất cả.`,
    browseLine: ({ entry, scenario, viewport, height, problems, value }) => `${entry} · ${scenario ?? "-"} · ${viewport} — ${height} px${problems.length ? ` · LỖI: ${problems.join("; ")}` : ""}${value !== undefined ? ` · eval: ${value}` : ""}`,
    browseSummary: ({ frames, broken }) => `đã xem ${frames} khung · ${broken} hỏng`,
    browseNoPictures: ({ max }) => `(bỏ ảnh khi quá ${max} khung)`,
    runExit: ({ code }) => `mã thoát ${code}`,
    runTimedOut: ({ seconds }) => `quá giờ sau ${seconds} giây — lệnh bị dừng và KHÔNG áp dụng gì`,
    runLanded: ({ list }) => `landed: ${list}`,
    runLandedNone: "landed: nothing",
    runDeleted: ({ list }) => `deleted: ${list}`,
    runRefused: ({ list }) => `bị từ chối:\n${list}`,
    runConflicts: ({ list }) => `xung đột (người dùng vừa sửa những file này — giữ bản của họ): ${list}`,
    runCut: "(đã cắt bớt kết quả)",

    // ── checks.mjs ──
    tscFailed: ({ project, output }) => `✗ tsc lỗi (${project}):\n${output}`,
    tscClean: ({ studio, version }) => `✓ tsc sạch (${studio ? "xưởng + " : ""}${version})`,

    // ── spec-lint.mjs (plain-language rule) ──
    lintCodeBlock: "khối code (tab Hành vi không chứa code)",
    lintTerms: "API|endpoint|SVG|URL|JSON|HTTP|UTC|null|undefined|true|false|query|params?|state|dirty|debounce|payload|cache|render|component|hook|banner|badge|pill|toast|modal|dropdown|slider|canvas|amber|emerald|server|client|frontend|backend|database|DB|SQL|schema|migration|cookie|token|session|timestamp|boolean|array|items",
    lintHttpCode: String.raw`\b(?:trả|lỗi|mã|status|HTTP|server)\s*(?:về\s*)?([2-5]\d{2})\b`,
  },
};
