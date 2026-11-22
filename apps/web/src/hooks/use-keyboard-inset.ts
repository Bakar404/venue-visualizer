"use client";

import { useEffect, useState } from "react";

/** Text fields that bring up the on-screen keyboard. */
function typing(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * Height in px that the on-screen keyboard covers at the bottom of the layout viewport. iOS Safari (and Chrome
 * with `interactive-widget=overlays-content`) keep the layout viewport and shrink only `visualViewport`, so fixed
 * layouts sized with `dvh` would end up under the keyboard. Browsers that resize the layout viewport report 0.
 * Only counts while a text field has focus and the page isn't pinch-zoomed (zooming shrinks `visualViewport` too).
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      if (!typing(document.activeElement) || Math.abs((vv.scale ?? 1) - 1) > 0.01) {
        setInset(0);
        return;
      }
      const covered = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      // Ignore small differences (URL bar animation): a keyboard is never this short.
      setInset(covered > 80 ? covered : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  return inset;
}
