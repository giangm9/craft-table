// The infinite canvas: wheel = zoom around the pointer; pan = middle button, or Space + left button, or left button
// on empty space (when NOT marking). Frames (iframes) swallow mouse events → frame-entry.tsx forwards them up
// through window.__studio.
// While MARKING: the left button only marks, starting anywhere (background or frame); on release the area goes to
// the frame it overlaps most, clipped to that frame's edges (pickTarget).
// Camera = CSS translate + scale (studio/lib/camera.mjs).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { cn } from "../ui";
import { fitCamera, zoomAt } from "../lib/camera.mjs";
import { isUsableRect, normalizeRect, pickTarget } from "../lib/geometry.mjs";
import type { Rect } from "./api";
import { T } from "./i18n/shell";

/** A frame registered with the canvas to receive marked areas. */
export type FrameHandle = { el: HTMLElement; open: (rect: Rect) => void; close: () => void };

export type Camera = { x: number; y: number; z: number };

type CanvasApi = {
  zoom: number;
  registerFrame: (key: string, h: FrameHandle) => () => void;
  /** Bring an element (inside the canvas) to the middle of the view (or to the top edge: align "top"), zoom at least `minZoom`. */
  focus: (el: Element, minZoom?: number, align?: "center" | "top") => void;
};
const Ctx = createContext<CanvasApi>({ zoom: 1, focus: () => {}, registerFrame: () => () => {} });
export const useCanvas = () => useContext(Ctx);

// Panning uses screenX/Y: independent of the frame (iframe) and of the transform that changes while panning.
type Bridge = {
  wheel: (w: Window, e: WheelEvent) => void;
  startPan: (e: PointerEvent) => void;
  panMove: (e: PointerEvent) => void;
  panEnd: () => void;
};

export function Canvas({ fitKey, annotating, children }: { fitKey: string; annotating: boolean; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<Camera>({ x: 40, y: 40, z: 0.5 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const [panning, setPanning] = useState(false);
  const panLast = useRef<{ x: number; y: number } | null>(null);
  const fitted = useRef<string | null>(null);
  const frames = useRef(new Map<string, FrameHandle>());
  const registerFrame = useCallback((key: string, h: FrameHandle) => {
    frames.current.set(key, h);
    return () => { if (frames.current.get(key) === h) frames.current.delete(key); };
  }, []);
  // Area being marked (screen px relative to the canvas); a ref so pointerup never reads stale state.
  const [draw, setDraw] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const [space, setSpace] = useState(false);
  const spaceRef = useRef(false);

  function panBy(sx: number, sy: number) {
    const last = panLast.current;
    if (!last) return;
    panLast.current = { x: sx, y: sy };
    setCam((c) => ({ ...c, x: c.x + sx - last.x, y: c.y + sy - last.y }));
  }
  function endPan() { panLast.current = null; setPanning(false); }

  const boxPoint = (clientX: number, clientY: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const wheelZoom = useCallback((clientX: number, clientY: number, deltaY: number, deltaMode: number) => {
    const d = deltaMode === 1 ? deltaY * 16 : deltaY; // lines → px (Firefox)
    setCam((c) => zoomAt(c, boxPoint(clientX, clientY), Math.exp(-d * 0.0015)));
  }, []);

  const fit = useCallback(() => {
    const box = boxRef.current, world = worldRef.current;
    if (!box || !world) return;
    setCam(fitCamera({ w: world.offsetWidth, h: world.offsetHeight }, { w: box.clientWidth, h: box.clientHeight }, 48));
  }, []);

  // Fit to the view whenever the board changes (once the content has a size).
  useLayoutEffect(() => {
    if (fitted.current === fitKey) return;
    const world = worldRef.current;
    if (!world) return;
    const ro = new ResizeObserver(() => {
      if (fitted.current === fitKey || world.offsetWidth === 0) return;
      fitted.current = fitKey;
      fit();
      ro.disconnect();
    });
    ro.observe(world);
    return () => ro.disconnect();
  }, [fitKey, fit]);

  // Wheel on the canvas background (passive: false to stop the page from scrolling).
  useEffect(() => {
    const box = boxRef.current!;
    const on = (e: WheelEvent) => {
      // Inside a scrollable box (data-canvas-scroll): let it scroll, do not zoom the canvas.
      if ((e.target as HTMLElement).closest("[data-canvas-scroll]")) return;
      e.preventDefault();
      wheelZoom(e.clientX, e.clientY, e.deltaY, e.deltaMode);
    };
    box.addEventListener("wheel", on, { passive: false });
    return () => box.removeEventListener("wheel", on);
  }, [wheelZoom]);

  // Bridge for the frames: coordinates inside an iframe → studio coordinates (the iframe is scaled by z).
  useEffect(() => {
    const frameRect = (w: Window) => {
      const f = [...document.querySelectorAll("iframe")].find((i) => i.contentWindow === w);
      return f?.getBoundingClientRect();
    };
    const bridge: Bridge = {
      wheel: (w, e) => {
        const r = frameRect(w);
        if (r) wheelZoom(r.left + e.clientX * camRef.current.z, r.top + e.clientY * camRef.current.z, e.deltaY, e.deltaMode);
      },
      startPan: (e) => { panLast.current = { x: e.screenX, y: e.screenY }; setPanning(true); },
      panMove: (e) => panBy(e.screenX, e.screenY),
      panEnd: () => endPan(),
    };
    (window as Window & { __studio?: Bridge }).__studio = bridge;
    return () => { delete (window as Window & { __studio?: Bridge }).__studio; };
  }, [wheelZoom]);

  // Holding Space = pan for a moment (as in Figma); works while marking too.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]");
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !typing(e)) { e.preventDefault(); spaceRef.current = true; setSpace(true); }
      if (e.key === "Escape") setDraw(null);
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") { spaceRef.current = false; setSpace(false); } };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); };
  }, []);

  // Middle button / Space + left = pan. Marking: left button = mark (anywhere).
  // Not marking: left button on the background = pan (inside a frame the frame takes it: the app stays clickable).
  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    // A spec sheet (data-nopan) does not pan the canvas: text can be selected, links clicked.
    const onBackground = !t.closest("[data-frame], [data-nopan]");
    if (e.button === 1 || (e.button === 0 && (spaceRef.current || (!annotating && onBackground)))) {
      e.preventDefault();
      panLast.current = { x: e.screenX, y: e.screenY };
      setPanning(true);
      return;
    }
    if (annotating && e.button === 0) {
      e.preventDefault();
      const p = boxPoint(e.clientX, e.clientY);
      setDraw({ a: p, b: p });
      boxRef.current!.setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drawRef.current;
    if (d) setDraw({ a: d.a, b: boxPoint(e.clientX, e.clientY) });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drawRef.current;
    if (!d) return;
    setDraw(null);
    // The end point comes from the release event (state may lag one render).
    const sel = normalizeRect(d.a, boxPoint(e.clientX, e.clientY));
    const b = boxRef.current!.getBoundingClientRect();
    const list = [...frames.current].map(([key, h]) => {
      const r = h.el.getBoundingClientRect();
      return { key, x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
    });
    const hit = pickTarget(sel, list, camRef.current.z);
    if (!hit || !isUsableRect(hit.rect)) return;
    for (const [key, h] of frames.current) if (key !== hit.key) h.close();
    frames.current.get(hit.key)!.open(hit.rect);
  };
  const onShieldMove = (e: React.PointerEvent) => panBy(e.screenX, e.screenY);

  const focus = useCallback((el: Element, minZoom = 0.6, align: "center" | "top" = "center") => {
    const box = boxRef.current;
    if (!box) return;
    const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
    // Use the camera ON SCREEN (it matches the DOM just measured), not state waiting to update: two calls in a row
    // (StrictMode, two frames) give the same result.
    const c = camRef.current;
    const z = Math.max(c.z, minZoom);
    // World coordinates of the element's centre, then put that centre in the middle of the view at the new zoom.
    const wx = (r.left + r.width / 2 - b.left - c.x) / c.z;
    const wy = (r.top + r.height / 2 - b.top - c.y) / c.z;
    if (align === "top") {
      // The element's top-left corner goes to (24, 24): read a document from its start.
      const tx = (r.left - b.left - c.x) / c.z, ty = (r.top - b.top - c.y) / c.z;
      setCam({ x: 24 - tx * z, y: 24 - ty * z, z });
      return;
    }
    setCam({ x: b.width / 2 - wx * z, y: b.height / 2 - wy * z, z });
  }, []);

  const zoomBy = (f: number) => {
    const box = boxRef.current!;
    setCam((c) => zoomAt(c, { x: box.clientWidth / 2, y: box.clientHeight / 2 }, f));
  };

  return (
    <Ctx.Provider value={{ zoom: cam.z, focus, registerFrame }}>
      <div
        ref={boxRef}
        data-canvas-bg
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDraw(null)}
        onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
        className={cn(
          "relative flex-1 min-w-0 overflow-hidden bg-ink-100 select-none",
          panning ? "cursor-grabbing" : space ? "cursor-grab" : annotating ? "cursor-crosshair" : "cursor-grab",
        )}
        style={{
          backgroundImage: "radial-gradient(circle, var(--color-ink-300) 1px, transparent 1px)",
          backgroundSize: `${24 * cam.z}px ${24 * cam.z}px`,
          backgroundPosition: `${cam.x}px ${cam.y}px`,
        }}
      >
        <div
          ref={worldRef}
          className="absolute left-0 top-0 origin-top-left cursor-default"
          style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`, width: "max-content" }}
        >
          {children}
        </div>
        {draw && (() => {
          const r = normalizeRect(draw.a, draw.b);
          return <div className="absolute z-30 pointer-events-none border-2 border-accent-600 bg-accent-500/10 rounded-md" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />;
        })()}
        {/* Shield while panning: takes pointermove instead of the iframes below. */}
        {panning && (
          <div className="fixed inset-0 z-[60] cursor-grabbing" onPointerMove={onShieldMove} onPointerUp={endPan} onPointerCancel={endPan} onPointerLeave={endPan} />
        )}
        <div className="absolute left-3 bottom-3 z-20 flex items-center gap-0.5 bg-surface border border-ink-200 rounded-lg p-0.5 shadow-sm" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" aria-label={T.zoomOut} title={T.zoomOutHint} onClick={() => zoomBy(1 / 1.25)} className="grid h-7 w-7 place-items-center rounded-md text-ink-600 hover:bg-ink-100"><Minus size={14} /></button>
          <button type="button" title={T.zoomReset} onClick={() => zoomBy(1 / cam.z)} className="h-7 w-11 text-[12px] tabular-nums text-ink-700 rounded-md hover:bg-ink-100">{Math.round(cam.z * 100)}%</button>
          <button type="button" aria-label={T.zoomIn} title={T.zoomInHint} onClick={() => zoomBy(1.25)} className="grid h-7 w-7 place-items-center rounded-md text-ink-600 hover:bg-ink-100"><Plus size={14} /></button>
          <button type="button" aria-label={T.fit} title={T.fit} onClick={fit} className="grid h-7 w-7 place-items-center rounded-md text-ink-600 hover:bg-ink-100"><Maximize size={14} /></button>
        </div>
      </div>
    </Ctx.Provider>
  );
}
