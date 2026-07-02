import { useEffect, useRef } from "react";
import throttle from "lodash/throttle";
import debounce from "lodash/debounce";

/**
 * AsciiHands
 *
 * Renders two floating, slowly-rotating "hands" as literal ASCII characters
 * inside <pre> elements (real text, selectable/inspectable — not canvas or
 * SVG), matching the ascii-left / ascii-right structure you found when
 * inspecting the original. Each panel's frames are computed in its own
 * Web Worker (see src/workers/asciiHand.worker.ts) because a single frame
 * of raymarching takes 40-90ms — too slow to run on the main thread without
 * jank. The worker posts back a plain string each tick and we assign it to
 * `pre.textContent` directly, bypassing React re-renders for that hot path.
 *
 * Mouse movement drives a lightweight CSS `translate` parallax on each
 * panel (the effect you noticed via the inline `transform` on `#ascii-left`).
 */

const FONT_STACK =
  '"JetBrains Mono", "SF Mono", "Cascadia Code", Consolas, "Courier New", monospace';

type PanelConfig = {
  mirror: boolean;
  phase: number;
  parallax: { x: number; y: number }; // px multiplier for mouse parallax depth
};

const PANELS: Record<"left" | "right", PanelConfig> = {
  left: { mirror: false, phase: 0, parallax: { x: 18, y: 10 } },
  right: { mirror: true, phase: Math.PI * 0.65, parallax: { x: 26, y: 14 } },
};

/** Measures the actual rendered size of a monospace character in this font/size. */
function measureCharCell(fontSizePx: number): { w: number; h: number } {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  probe.style.fontFamily = FONT_STACK;
  probe.style.fontSize = `${fontSizePx}px`;
  probe.style.lineHeight = "1";
  probe.textContent = "MMMMMMMMMM";
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 10;
  const h = fontSizePx * 1.05; // approx line-height used on the <pre>
  document.body.removeChild(probe);
  return { w, h };
}

function usePanel(side: "left" | "right", fontSizePx: number) {
  const preRef = useRef<HTMLPreElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const pre = preRef.current;
    if (!wrap || !pre) return;

    const cfg = PANELS[side];
    const cell = measureCharCell(fontSizePx);
    const charAspect = cell.w / cell.h;

    const worker = new Worker(
      new URL("../workers/asciiHand.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<{ type: string; text: string }>) => {
      if (ev.data.type === "frame" && pre.isConnected) {
        pre.textContent = ev.data.text;
      }
    };

    const sendSize = () => {
      const rect = wrap.getBoundingClientRect();
      const cols = Math.max(10, Math.floor(rect.width / cell.w));
      const rows = Math.max(6, Math.floor(rect.height / cell.h));
      worker.postMessage({
        type: "config",
        cols,
        rows,
        mirror: cfg.mirror,
        phase: cfg.phase,
        charAspect,
      });
    };
    sendSize();

    const onResize = debounce(sendSize, 150);
    window.addEventListener("resize", onResize);

    const onVisibility = () => {
      if (document.hidden) {
        worker.postMessage({ type: "stop" });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      worker.postMessage({ type: "stop" });
      worker.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, fontSizePx]);

  return { preRef, wrapRef };
}

export default function AsciiHands() {
  const fontSizePx = 13;
  const left = usePanel("left", fontSizePx);
  const right = usePanel("right", fontSizePx);

  // Mouse-driven parallax translate, applied straight to style.transform
  // (no React state) so it stays smooth and independent of the worker frame rate.
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const apply = (clientX: number, clientY: number) => {
      const nx = (clientX / window.innerWidth) * 2 - 1; // -1..1
      const ny = (clientY / window.innerHeight) * 2 - 1;

      const l = PANELS.left.parallax;
      const r = PANELS.right.parallax;
      if (left.preRef.current) {
        left.preRef.current.style.transform = `translate(${(-nx * l.x).toFixed(3)}px, ${(-ny * l.y).toFixed(3)}px)`;
      }
      if (right.preRef.current) {
        right.preRef.current.style.transform = `translate(${(-nx * r.x).toFixed(3)}px, ${(-ny * r.y).toFixed(3)}px)`;
      }
    };

    const onMove = throttle((e: MouseEvent) => apply(e.clientX, e.clientY), 30, {
      leading: true,
      trailing: true,
    });

    window.addEventListener("mousemove", onMove);
    // center by default
    apply(window.innerWidth / 2, window.innerHeight / 2);

    return () => {
      window.removeEventListener("mousemove", onMove);
      onMove.cancel();
    };
  }, [left.preRef, right.preRef]);

  return (
    <div className="ascii-hands-stage">
      <div className="ascii-hands-panel ascii-hands-panel--left" ref={left.wrapRef}>
        <pre id="ascii-left" ref={left.preRef} className="ascii-hands-pre" />
      </div>
      <div className="ascii-hands-panel ascii-hands-panel--right" ref={right.wrapRef}>
        <pre id="ascii-right" ref={right.preRef} className="ascii-hands-pre" />
      </div>
    </div>
  );
}
