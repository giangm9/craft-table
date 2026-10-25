// One frame (desktop 1280 / mobile 390) of one scenario, drawn at its real size inside the canvas (Canvas handles
// zoom / pan / marking). The iframe is as tall as its content → a mark's coordinates are real document
// coordinates; Claude crops the screenshot at exactly those numbers (chat.mjs crop).
// The frame shows the MARKERS of the open conversation thread (+ the ones being composed); a newly marked area goes
// to the composer (onRef), there is no floating comment box on the canvas any more.
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import { ExternalLink, Monitor, Smartphone } from "lucide-react";
import { cn } from "../ui";
import { textsInRect } from "../lib/geometry.mjs";
import { type Entry, type Rect, type Theme, type Viewport } from "./api";
import { DESKTOP, deviceOf, frameSize, fullHeight } from "../lib/devices.mjs";

/** The project's desktop frame size (craft-table.json "desktop", the Settings) — main.tsx provides it. */
export const DesktopSize = createContext<{ w: number; h: number }>(DESKTOP);
import { deviceName } from "./i18n/values";
import { T } from "./i18n/shell";
import { useCanvas } from "./Canvas";

export type Marker = { key: string; n: number | string; rect: Rect; tone: "user" | "claude" | "pending" };

type Props = {
  entry: Entry;
  /** Version (versions/<v>); none → the frame asks for the live one. */
  version?: string;
  /** Version label above the frame (when comparing two versions). */
  versionLabel?: string;
  /** Device of the mobile frame (studio/lib/devices.mjs): fixed size, scrolls inside (desktop is fixed at 1280×800);
   *  "full" = both as tall as their content (with a cap). */
  device?: string;
  scenario: string | null;
  viewport: Viewport;
  theme: Theme;
  markers: Marker[];
  annotating: boolean;
  focusKey: string | null;
  onMarker: (key: string) => void;
  onRef: (d: { rect: Rect; texts: string[] }) => void;
};

function collectTextItems(doc: Document) {
  const win = doc.defaultView!;
  const items: Array<{ text: string; x: number; y: number; w: number; h: number }> = [];
  const push = (text: string, r: DOMRect) => {
    if (r.width || r.height) items.push({ text, x: r.left + win.scrollX, y: r.top + win.scrollY, w: r.width, h: r.height });
  };
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  const range = doc.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim()) continue;
    range.selectNodeContents(n);
    push(n.textContent, range.getBoundingClientRect());
  }
  // Icon-only buttons, empty inputs: take their label so Claude still knows what they are.
  doc.querySelectorAll("[aria-label],[placeholder],[title]").forEach((el) => {
    const label = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title");
    if (label) push(`[${label}]`, el.getBoundingClientRect());
  });
  return items;
}

/** Counter the zoom: the element keeps its on-screen size whatever the zoom (capped, so it is not huge at a tiny zoom). */
const unzoom = (z: number, origin = "top left"): CSSProperties => ({ transform: `scale(${Math.min(1 / z, 4)})`, transformOrigin: origin });

const TONE = {
  user: { box: "border-2 border-accent-600", active: "bg-accent-500/15 ring-4 ring-accent-500/25", badge: "bg-accent-700 text-white" },
  claude: { box: "border-2 border-sky-500", active: "bg-sky-500/10 ring-4 ring-sky-500/25", badge: "bg-sky-600 text-white" },
  pending: { box: "border-2 border-dashed border-accent-600 bg-accent-500/5", active: "ring-4 ring-accent-500/25", badge: "bg-surface text-accent-800 border-accent-600" },
};

export function Frame(p: Props) {
  const { zoom, focus, registerFrame } = useCanvas();
  const desktop = useContext(DesktopSize);
  const { w: width, h: fixedH } = frameSize(p.viewport, p.device, desktop);
  const dev = p.viewport === "mobile" ? deviceOf(p.device) : null;
  const minH = p.entry.meta.minHeight ?? 0;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(Math.max(minH, 600));
  const height = fixedH ?? measured;
  // Device-sized frame: the content scrolls INSIDE → markers and marked areas must account for the scrolled part.
  const [scrollY, setScrollY] = useState(0);
  const scrollRef = useRef(0);
  const src = `/frame?${p.version ? `v=${encodeURIComponent(p.version)}&` : ""}e=${encodeURIComponent(p.entry.id)}${p.scenario ? `&s=${encodeURIComponent(p.scenario)}` : ""}&th=${p.theme}${fixedH ? "&fix=1" : ""}`;
  const onRef = useRef(p.onRef);
  onRef.current = p.onRef;

  // Measure the content height on every frame load (including Vite's reload after a file edit).
  const onLoad = () => {
    const ifr = iframeRef.current;
    const win = ifr?.contentWindow as (Window & typeof globalThis) | null;
    const doc = ifr?.contentDocument;
    const root = doc?.getElementById("root");
    if (!win || !doc || !root) return;
    const measure = () => setMeasured(fullHeight(Math.max(root.scrollHeight, root.getBoundingClientRect().height), minH));
    measure();
    new win.ResizeObserver(measure).observe(root);
    scrollRef.current = 0;
    setScrollY(0);
    win.addEventListener("scroll", () => { scrollRef.current = win.scrollY; setScrollY(win.scrollY); }, { passive: true });
  };

  // A marker picked (in the conversation) → the canvas brings that area to the middle of the view.
  useEffect(() => {
    if (!p.focusKey) return;
    // Device-sized frame: scroll the frame to the area first (a marker outside the visible part cannot be centred).
    const m = p.markers.find((x) => x.key === p.focusKey);
    const win = iframeRef.current?.contentWindow;
    if (fixedH && m && win) win.scrollTo({ top: Math.max(0, m.rect.y - 48) });
    const t = setTimeout(() => {
      const el = boxRef.current?.querySelector(`[data-ref="${CSS.escape(p.focusKey!)}"]`);
      if (el) focus(el);
    }, fixedH ? 60 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focusKey]);

  // The canvas does the marking: on release it hands the area (document px, clipped to the edges) to the frame it
  // overlaps most → the frame collects the texts inside it and sends both to the composer.
  useEffect(() => registerFrame(`${p.scenario ?? ""}:${p.viewport}`, {
    el: boxRef.current!,
    open: (rect) => {
      const doc = iframeRef.current?.contentDocument;
      const r = { ...rect, y: rect.y + scrollRef.current }; // document coordinates = frame coordinates + the scrolled part
      onRef.current({ rect: r, texts: doc ? textsInRect(collectTextItems(doc), r) : [] });
    },
    close: () => {},
  }), [registerFrame, p.scenario, p.viewport]);

  return (
    <div data-frame className="shrink-0" style={{ width }}>
      {/* The label keeps its on-screen size; at a small zoom (< 62%) it hides so it does not cover the scenario's name. */}
      <div className="relative h-10">
        {zoom >= 0.62 && (
          <div className="absolute left-0 bottom-1.5 flex items-center gap-1.5 text-xs text-ink-500 whitespace-nowrap" style={unzoom(zoom, "bottom left")}>
            {p.viewport === "desktop" ? <Monitor size={14} /> : <Smartphone size={14} />}
            <span className="font-medium text-ink-700">{p.viewport === "desktop" ? `${T.viewport.desktop} · ${width}${fixedH ? `×${fixedH}` : ""}` : `${deviceName(dev!)} · ${width}${fixedH ? `×${fixedH}` : ""}`}</span>
            {p.versionLabel && <span className="px-1.5 rounded bg-accent-50 border border-accent-200 text-accent-800 font-medium">{p.versionLabel}</span>}
            <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg hover:bg-ink-200 hover:text-ink-900" title={T.openFrameHint}>
              <ExternalLink size={12} /> {T.openFrame}
            </a>
          </div>
        )}
      </div>
      <div ref={boxRef} className="relative" style={{ width, height }}>
        {/* Rounded clipping for the iframe only; the border is an outline (takes no room) → the iframe is a full 1280/390px. */}
        <div className="absolute inset-0 bg-surface rounded-xl overflow-hidden outline outline-1 outline-ink-200">
          <iframe
            ref={iframeRef}
            src={src}
            title={`${p.entry.meta.title} · ${p.scenario ?? ""} · ${p.viewport}`}
            onLoad={onLoad}
            className="absolute left-0 top-0 border-0 block"
            style={{ width, height }}
          />
        </div>
        {/* Marker layer. Not marking: the pointer goes through so the prototype stays clickable (only the marker
            numbers take clicks). Marking: this layer covers the iframe so the pointer reaches the canvas, which draws the mark. */}
        <div className={cn("absolute inset-0 z-10", fixedH != null && "overflow-hidden rounded-xl", p.annotating ? "cursor-crosshair touch-none" : "pointer-events-none")}>
          {p.markers.map((m) => {
            const t = TONE[m.tone];
            const active = m.key === p.focusKey;
            return (
              <div key={m.key} data-ref={m.key} className={cn("absolute rounded-md", t.box, active && t.active)} style={{ left: m.rect.x, top: m.rect.y - scrollY, width: m.rect.w, height: m.rect.h }}>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => p.onMarker(m.key)}
                  style={unzoom(zoom)}
                  className={cn("pointer-events-auto absolute -left-2.5 -top-2.5 min-w-[22px] h-[22px] px-1 rounded-full text-[11px] font-semibold tabular-nums inline-flex items-center justify-center border-2", m.tone === "pending" ? t.badge : cn(t.badge, "border-surface"))}
                >
                  {m.tone === "pending" ? `+${m.n}` : `#${m.n}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
