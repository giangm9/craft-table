// Read compatibility for values earlier versions of the studio stored, when it wrote Vietnamese words into project
// files, data and URLs. Stored values are now neutral codes (the studio speaks English and Vietnamese);
// writers write codes, and every reader passes what it reads through here, so old projects, old rows in
// data/studio.sqlite and old bookmarks keep working forever. This is the ONLY place that knows the old words.
// Pure (no Node imports): shared by the server libs and the studio UI.

const VERSION_STATUS = { "đang thiết kế": "draft", "đã chốt": "approved", "đã lên app": "live", "lưu trữ": "archived" };
const OPTION_STATUS = { "đang thử": "trying", "đã chốt": "adopted" };
const BOARD_STATUS = { "hiện tại": "current", "đề xuất": "proposed", "chốt": "approved" };
const AUTHOR = { "khởi tạo": "init", "ngoài xưởng": "external" };
/** URL parameter → { old value: new value }. Only values change; parameter names stay. */
const URL_VALUES = {
  rp: { "lich-su": "history" },
  opt: { ten: "rename", chot: "adopt", bo: "remove", moi: "new" },
  dev: { "ca-trang": "full", "android-nho": "android-small" },
};

const mapped = (table, v) => (typeof v === "string" && Object.hasOwn(table, v) ? table[v] : v);

/** versions/<v>/version.json "status" → "draft" | "approved" | "live" | "archived" (an unknown value is returned as is). */
export const versionStatusCode = (s) => mapped(VERSION_STATUS, s);
/** Option meta option.status → "trying" | "adopted" (unknown → as is). */
export const optionStatusCode = (s) => mapped(OPTION_STATUS, s);
/** Board meta "status" → "current" | "proposed" | "approved"; any other value is the project's own word, kept. */
export const boardStatusCode = (s) => mapped(BOARD_STATUS, s);
/** History author written by the studio itself → "init" | "external"; emails and "claude" are kept. */
export const authorCode = (a) => mapped(AUTHOR, a);
/** Value of URL parameter `name` → the current value (old bookmarks: rp=lich-su, opt=chot, dev=ca-trang…). */
export const urlValue = (name, value) => (Object.hasOwn(URL_VALUES, name) ? mapped(URL_VALUES[name], value) : value);

/**
 * Spec page id (lib/spec-core.mjs specPages) written with the old default slugs → the new id: "tong-quan" (the
 * part before the first ##) → "overview", "muc[-n]" (a heading with no letters) → "section[-n]", per path segment.
 */
export function specPageId(id) {
  if (typeof id !== "string") return id;
  return id.split("/").map((s) => (s === "tong-quan" ? "overview" : s.replace(/^muc(-\d+)?$/, "section$1"))).join("/");
}

/** Id given to a scenario added in the screen-info form until it gets a name (MetaEditor): scenario-N. */
export const TEMP_SCENARIO_PREFIX = "scenario-";
/** Still a temporary scenario id (new prefix, or the old kich-ban-N)? Only those may be renamed after the title. */
export const isTempScenarioId = (id) => typeof id === "string" && /^(scenario|kich-ban)-\d+$/.test(id);
