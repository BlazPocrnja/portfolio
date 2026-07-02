import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import asciiLeftText from "../../../public/assets/ascii-left.txt?raw";
import asciiRightText from "../../../public/assets/ascii-right.txt?raw";

gsap.registerPlugin(ScrollTrigger);

/**
 * Footer
 *
 * Rebuild of the real technique found via inspection:
 *  - #ascii-left / #ascii-right are STATIC text (no per-frame generation).
 *    The only per-frame work is a requestAnimationFrame loop that lerps the
 *    raw mouse position toward a smoothed value and applies it as a plain
 *    CSS translate() to each <pre>. That loop only runs while the footer
 *    is on screen (gated by a ScrollTrigger-driven `footerVisible` flag).
 *  - The "Blaz" / "Pocrnja." wordmark is split into one <span> per
 *    character (2-layer: an overflow-hidden outer + a translating inner)
 *    and revealed via a scroll-scrubbed GSAP stagger, interleaved so it
 *    reads as converging from both sides toward the middle.
 *  - Nav links ("GITHUB", "WORK", etc.) are split the same way into
 *    ch-top/ch-bot pairs for a roll-over hover effect, and the top layer
 *    wipes in via clipPath when the footer enters view.
 *
 * NOTE on ascii-right.txt: only the left panel's ASCII content was ever
 * shared with me. ascii-right.txt is a bracket-aware horizontal mirror of
 * that same content, generated as a stand-in — swap in the real content if
 * you have it and the shapes will line up as two hands rather than a hand
 * mirrored against itself.
 */

const NAV_LEFT = [
  { label: "GITHUB", href: "https://github.com" },
  { label: "LINKEDIN", href: "https://linkedin.com" },
  { label: "BEHANCE", href: "https://behance.net" },
];
const NAV_RIGHT = [
  { label: "WORK", href: "#work" },
  { label: "INFO", href: "#info" },
  { label: "CONTACT", href: "#contact" },
];

/** Splits text into `.ch-wrap > .ch-top + .ch-bot` pairs for the hover-flip effect. */
function ChrHover({ text }: { text: string }) {
  return (
    <span className="chr-hover" aria-label={text}>
      {Array.from(text).map((ch, i) =>
        ch === " " ? (
          <span key={i} className="ch-space" aria-hidden="true" />
        ) : (
          <span key={i} className="ch-wrap" style={{ "--i": i } as CSSProperties}>
            <span className="ch-top" aria-hidden="true">{ch}</span>
            <span className="ch-bot" aria-hidden="true">{ch}</span>
          </span>
        ),
      )}
    </span>
  );
}

/** Rebuilds `el`'s text into one span-pair per character; returns the inner (animatable) spans. */
function rebuildChars(el: HTMLElement, keepFirstLetter: boolean): HTMLElement[] {
  const text = el.textContent ?? "";
  el.textContent = "";
  const inners: HTMLElement[] = [];
  for (let i = 0; i < text.length; i++) {
    const outer = document.createElement("span");
    outer.style.display = "inline-block";
    outer.style.overflow = "hidden";
    outer.style.verticalAlign = "top";
    outer.style.padding = "0.1em 0.3em";
    outer.style.margin = "-0.1em -0.3em";
    if (keepFirstLetter && i === 0) outer.className = "first-letter";

    const inner = document.createElement("span");
    inner.style.display = "inline-block";
    inner.style.willChange = "transform";
    inner.textContent = text[i];

    outer.appendChild(inner);
    el.appendChild(outer);
    inners.push(inner);
  }
  return inners;
}

export default function Footer() {
  const footerRef = useRef<HTMLElement>(null);
  const transitionRef = useRef<HTMLDivElement>(null);
  const asciiLeftRef = useRef<HTMLPreElement>(null);
  const asciiRightRef = useRef<HTMLPreElement>(null);
  const blazRef = useRef<HTMLSpanElement>(null);
  const pocrnjaRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const footerEl = footerRef.current;
    const transitionEl = transitionRef.current;
    const asciiLeftPre = asciiLeftRef.current;
    const asciiRightPre = asciiRightRef.current;
    if (!footerEl || !transitionEl) return;

    const ctx = gsap.context(() => {
      // --- mouse parallax on the static ascii panels, scroll-gated ---
      let mx = 0, my = 0, sx = 0, sy = 0;
      let footerVisible = false;
      let rafId: number | null = null;

      const onMouseMove = (e: MouseEvent) => {
        mx = (e.clientX / window.innerWidth - 0.5) * 2;
        my = (e.clientY / window.innerHeight - 0.5) * 2;
      };
      window.addEventListener("mousemove", onMouseMove);

      function parallaxLoop() {
        if (!footerVisible) { rafId = null; return; }
        sx += (mx - sx) * 0.05;
        sy += (my - sy) * 0.05;
        const lx = Math.min(0, sx * -15 - 15);
        const rx = Math.max(0, sx * 15 + 15);
        const py = sy * -10;
        if (asciiLeftPre) asciiLeftPre.style.transform = `translate(${lx}px, ${py}px)`;
        if (asciiRightPre) asciiRightPre.style.transform = `translate(${rx}px, ${py}px)`;
        rafId = requestAnimationFrame(parallaxLoop);
      }

      // --- nav link wipe-in (top layer) on scroll ---
      const footerTopChars = footerEl.querySelectorAll<HTMLElement>(".footer-top .chr-hover .ch-top");
      if (footerTopChars.length) {
        gsap.set(footerTopChars, { clipPath: "inset(100% 0 0 0)" });
        gsap.to(footerTopChars, {
          clipPath: "inset(0 0 0 0)",
          ease: "power3.out",
          stagger: { each: 0.015, from: "start" },
          scrollTrigger: {
            trigger: transitionEl,
            start: "center bottom+=500",
            end: "bottom bottom",
            scrub: true,
          },
        });
      }

      // --- wordmark character reveal ---
      if (blazRef.current && pocrnjaRef.current) {
        const blazChars = rebuildChars(blazRef.current, true);
        const pocrnjaChars = rebuildChars(pocrnjaRef.current, false);
        const dotChars = dotRef.current ? rebuildChars(dotRef.current, false) : [];

        const ordered: HTMLElement[] = [];
        const blazRev = blazChars.slice().reverse();
        const rightSide = pocrnjaChars.concat(dotChars);
        const maxLen = Math.max(blazRev.length, rightSide.length);
        for (let i = 0; i < maxLen; i++) {
          if (rightSide[i]) ordered.push(rightSide[i]);
          if (blazRev[i]) ordered.push(blazRev[i]);
        }

        gsap.set(ordered, { yPercent: 110 });
        gsap.to(ordered, {
          yPercent: 0,
          ease: "power3.out",
          stagger: { each: 0.04, from: "start" },
          scrollTrigger: {
            trigger: transitionEl,
            start: "center bottom+=500",
            end: "bottom bottom",
            scrub: true,
          },
        });
      }

      // --- footer visibility + parallax-loop gate, tied to scroll ---
      ScrollTrigger.create({
        trigger: transitionEl,
        start: "top bottom+=500",
        end: "bottom bottom",
        onEnter: () => {
          footerEl.style.visibility = "visible";
          footerVisible = true;
          if (rafId === null) parallaxLoop();
        },
        onEnterBack: () => {
          footerVisible = true;
          if (rafId === null) parallaxLoop();
        },
        onLeaveBack: () => {
          footerEl.style.visibility = "hidden";
          footerVisible = false;
        },
      });

      return () => {
        window.removeEventListener("mousemove", onMouseMove);
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    }, footerEl);

    return () => ctx.revert();
  }, []);

  return (
    <>
      {/* Drives the scroll-scrubbed reveal above; give it real height in your page. */}
      <div id="footer-transition" ref={transitionRef} className="footer-transition" />

      <footer id="footer" ref={footerRef} className="site-footer">
        <div className="footer-top">
          <div className="footer-top-group footer-top-left">
            <a className="footer-meta-link" href="mailto:blaz.pocrnja@yahoo.com">
              blaz.pocrnja@yahoo.com
            </a>
            <span className="footer-meta">© 2026</span>
          </div>

          <nav className="footer-top-group footer-top-nav-left">
            {NAV_LEFT.map((item) => (
              <a key={item.label} href={item.href} className="footer-nav-link">
                <ChrHover text={item.label} />
              </a>
            ))}
          </nav>

          <nav className="footer-top-group footer-top-nav-right">
            {NAV_RIGHT.map((item) => (
              <a key={item.label} href={item.href} className="footer-nav-link">
                <ChrHover text={item.label} />
              </a>
            ))}
          </nav>
        </div>

        <div className="footer-ascii">
          <pre id="ascii-left" ref={asciiLeftRef} className="footer-ascii-pre">
            {asciiLeftText}
          </pre>
          <pre id="ascii-right" ref={asciiRightRef} className="footer-ascii-pre">
            {asciiRightText}
          </pre>
        </div>

        <div className="footer-names">
          <span ref={blazRef} className="footer-name-blaz">Blaz</span>
          <span className="footer-name-right">
            <span ref={pocrnjaRef} className="footer-name-pocrnja">Pocrnja</span>
            <span ref={dotRef} className="footer-name-dot">.</span>
          </span>
        </div>
      </footer>
    </>
  );
}
