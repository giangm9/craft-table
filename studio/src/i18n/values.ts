// Labels of the neutral codes the studio stores in project files and data (statuses, history authors, devices).
// The codes are never words of a language; values written by earlier versions (Vietnamese words) are read as codes
// through studio/lib/legacy-values.mjs, so every label helper accepts old values too. An unknown value (a project's
// own word in a board's meta "status") is shown as it is.
import { pick } from "./index";
import { authorCode, boardStatusCode, optionStatusCode, versionStatusCode } from "../../lib/legacy-values.mjs";

const en = {
  /** versions/<v>/version.json "status" (studio/lib/versions.mjs VERSION_STATUSES). */
  versionStatus: { draft: "In design", approved: "Approved", live: "Shipped", archived: "Archived" },
  /** Option meta option.status (studio/lib/option-meta.mjs OPTION_STATUSES) — shown mid-sentence, lowercase. */
  optionStatus: { trying: "trying", adopted: "adopted" },
  /** Board meta "status" (screen info form, screen list). */
  boardStatus: { current: "Current", proposed: "Proposed", approved: "Approved" },
  /** History authors the studio writes itself (studio/lib/history-recorder.mjs). */
  author: { init: "Initial", external: "Outside the studio" },
  /** Devices whose name is a word, not a model (studio/lib/devices.mjs); other devices keep their model name. */
  device: { "android-small": "Small Android", full: "Whole page" },
};

const vi: typeof en = {
  versionStatus: { draft: "đang thiết kế", approved: "đã chốt", live: "đã lên app", archived: "lưu trữ" },
  optionStatus: { trying: "đang thử", adopted: "đã chốt" },
  boardStatus: { current: "hiện tại", proposed: "đề xuất", approved: "chốt" },
  author: { init: "Khởi tạo", external: "Ngoài xưởng" },
  device: { "android-small": "Android nhỏ", full: "Cả trang" },
};

export const VALUE_TEXTS = { en, vi };
export const V = pick(VALUE_TEXTS);

export type VersionStatus = keyof typeof en.versionStatus;
export type OptionStatus = keyof typeof en.optionStatus;
export type BoardStatus = keyof typeof en.boardStatus;

const label = (m: Record<string, string>, code: unknown) => (typeof code === "string" && Object.hasOwn(m, code) ? m[code] : String(code ?? ""));

/** "live" (or the old "đã lên app") → "Shipped" / "đã lên app". */
export const versionStatusLabel = (s: string | null | undefined) => label(V.versionStatus, versionStatusCode(s));
/** "adopted" (or "đã chốt") → "adopted" / "đã chốt". */
export const optionStatusLabel = (s: string | null | undefined) => label(V.optionStatus, optionStatusCode(s));
/** "current" (or "hiện tại") → "Current" / "hiện tại"; any other value as it is. */
export const boardStatusLabel = (s: string | null | undefined) => label(V.boardStatus, boardStatusCode(s));
/** "init" / "external" (or the old words) → label; an email or "claude" as it is. */
export const authorLabel = (a: string | null | undefined) => label(V.author, authorCode(a));
/** Name of a device of the phone select / a frame label: a word in this page's language, or the model name. */
export const deviceName = (d: { id?: string; name?: string }) => (d.id && Object.hasOwn(V.device, d.id) ? (V.device as Record<string, string>)[d.id] : d.name ?? "");
