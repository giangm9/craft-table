// Texts of the studio's own UI kit (studio/ui/: dialogs, notices, load errors…). Pattern: ./index.ts.
// These are defaults: every component that shows one also takes a prop to say something more precise.
import { pick } from "./index";

const en = {
  // ConfirmDialog
  cancel: "Cancel",
  /** The confirm button while the action runs (busy). */
  working: "Working…",
  // LoadError: says the data could NOT be loaded (not "there is nothing"), keeps the reference code, offers a retry.
  /** Heading; `what` names the data ("the history"), none → the data in general. */
  loadFailed: (what?: string) => `Couldn't load ${what ?? "the data"}`,
  loadFailedDetail: "The network may be unstable. Your data is not lost.",
  /** Followed by the code, e.g. a request id the server returned. */
  referenceCode: "Reference code:",
  retrying: "Retrying…",
  retry: "Try again",
  // Modal
  close: "Close",
};

const vi: typeof en = {
  cancel: "Huỷ",
  working: "Đang xử lý…",
  loadFailed: (what) => `Không tải được ${what ?? "dữ liệu"}`,
  loadFailedDetail: "Có thể do mạng chập chờn. Dữ liệu của bạn không bị mất.",
  referenceCode: "Mã tra cứu:",
  retrying: "Đang thử lại…",
  retry: "Thử lại",
  close: "Đóng",
};

/** Both languages (for the unit test, studio/lib/shell-i18n.test.mjs); components use T. */
export const UI_TEXTS = { en, vi };
export const T = pick(UI_TEXTS);
