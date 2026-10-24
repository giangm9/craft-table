// A frame = one board of ONE VERSION (versions/<v>/boards/), rendered with real React and that version's own
// design system tokens. It loads exactly that file (?v=<version>&e=<id>) and passes the scenario (?s=<id>) to the
// board as its `scenario` prop. No ?v= → the live version (asked from the server; if that fails the frame says so
// plainly and never guesses a version: lib/frame-version.mjs). Editing the file makes Vite reload the frame.
// The studio's own texts drawn here (error strip, missing board) are in the VIEWER's language: the server puts it in
// data-ui-lang, while <html lang> stays the project's (the board's content); i18n/index.ts reads data-ui-lang.
//
// The frame sits on the studio's infinite canvas: the mouse wheel (zoom) and the middle button (pan) fire inside
// the iframe and never reach the studio → they are forwarded up to the studio here.
import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { boardError } from "../lib/vite-error.mjs";
import { frameVersion } from "../lib/frame-version.mjs";
import { lang } from "./i18n/index";
import { T } from "./i18n/shell";

type BoardProps = { scenario?: string };
// Loaded by PATH (no import.meta.glob): a glob would make the frame depend on the file list of every version, so
// creating or deleting a version would make Vite reload every page. The path is built only from checked ids (no "..").
const SAFE = /^[a-z0-9][a-z0-9/_~-]*$/;
const params = new URLSearchParams(location.search);
const id = params.get("e") ?? "";
const scenario = params.get("s") ?? undefined;
const root = createRoot(document.getElementById("root")!);
document.title = T.frameTitle; // before the board renders: a board that sets its own title still wins

type StudioBridge = {
  wheel: (frame: Window, e: WheelEvent) => void;
  startPan: (e: PointerEvent) => void;
  panMove: (e: PointerEvent) => void;
  panEnd: () => void;
};
const bridge = () => (window.parent !== window ? (window.parent as Window & { __studio?: StudioBridge }).__studio : undefined);
// Fixed-size frame (fix=1: desktop 1280×800, mobile per device): the wheel SCROLLS the content inside the frame;
// Ctrl/⌘ + wheel (including a two-finger pinch on a trackpad) zooms the canvas. A "Whole page" frame (as tall as its
// content): every wheel zooms the canvas.
const fixedFrame = new URLSearchParams(location.search).get("fix") === "1";
addEventListener("wheel", (e) => {
  const b = bridge();
  if (!b) return;
  if (fixedFrame && !e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  b.wheel(window, e);
}, { passive: false });
// While a button is held inside an iframe the browser keeps every mouse event in the iframe until release
// → forward the moves and the release up to the studio ourselves.
let panning = false;
addEventListener("pointerdown", (e) => {
  const b = bridge();
  if (b && e.button === 1) { e.preventDefault(); panning = true; b.startPan(e); }
});
addEventListener("pointermove", (e) => { if (panning) bridge()?.panMove(e); });
addEventListener("pointerup", (e) => { if (panning && e.button === 1) { panning = false; bridge()?.panEnd(); } });
// Stop the middle button from starting the browser's auto-scroll.
addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });

// The frame must NOT take the studio's keyboard when it loads (a board may use autoFocus, e.g. a scenario with
// a form open) — otherwise C/Esc/Space would type into the frame instead of driving the studio. Focus is allowed
// only after the person clicks inside the frame. Opened on its own (not inside the studio), focus works as usual.
if (window.parent !== window) {
  let touched = false;
  addEventListener("pointerdown", () => { touched = true; }, true);
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, opts?: FocusOptions) { if (touched) focus.call(this, opts); };
  // Clicked inside the frame (focus is inside) but not typing → the studio's shortcuts still work.
  const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest("input, textarea, select, [contenteditable]");
  for (const type of ["keydown", "keyup"] as const) {
    addEventListener(type, (e) => {
      if (typing(e.target)) return;
      if (e.key === "c" || e.key === "C" || e.key === "Escape" || e.code === "Space") {
        if (e.code === "Space") e.preventDefault();
        window.parent.dispatchEvent(new KeyboardEvent(type, { key: e.key, code: e.code }));
      }
    });
  }
}

// A compile error in THIS board (e.g. half-typed code in the Code pane): a red strip at the bottom of the frame, which
// keeps its last good render; the next update of the (fixed) file removes it. Errors of other files are not shown here.
function watchBoardErrors(file: string) {
  let box: HTMLDivElement | null = null;
  const clear = () => { box?.remove(); box = null; };
  import.meta.hot?.on("vite:error", (p: { err?: Parameters<typeof boardError>[0] }) => {
    const e = boardError(p.err, file);
    if (!e) return;
    clear();
    box = document.createElement("div");
    box.setAttribute("data-board-error", "");
    box.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#fff1f2;border-top:2px solid #e11d48;color:#881337;font:13px/1.45 ui-sans-serif,system-ui,sans-serif;padding:10px 14px;max-height:40%;overflow:auto;white-space:pre-wrap";
    box.textContent = T.boardError({ line: e.line, message: e.message });
    document.body.appendChild(box);
  });
  import.meta.hot?.on("vite:afterUpdate", (p: { updates?: { path?: string }[] }) => {
    if (p.updates?.some((u) => u.path?.endsWith(file))) clear();
  });
}

async function boot() {
  const found = await frameVersion(params.get("v"), (url) => fetch(url), { lang });
  if (found.error !== undefined) {
    return root.render(<p role="alert" style={{ padding: 24, fontFamily: "sans-serif", color: "#881337" }}>{found.error}</p>);
  }
  const v = found.version;
  const missing = () => root.render(<p style={{ padding: 24, fontFamily: "sans-serif" }}>{T.boardMissing({ version: v, id })}</p>);
  if (!SAFE.test(v) || !SAFE.test(id) || id.split("/").some((s) => s.startsWith("_"))) return missing();
  watchBoardErrors(`/versions/${v}/boards/${id}.tsx`);
  let C: ComponentType<BoardProps>;
  try {
    await import(/* @vite-ignore */ `/versions/${v}/system/tokens.css`);
    C = ((await import(/* @vite-ignore */ `/versions/${v}/boards/${id}.tsx`)) as { default: ComponentType<BoardProps> }).default;
  } catch {
    return missing();
  }
  root.render(
    <StrictMode>
      <C scenario={scenario} />
    </StrictMode>,
  );
}
void boot();
