"use client";

import { useEffect, useState } from "react";

/**
 * Height in px that the on-screen keyboard covers at the bottom of the layout viewport. iOS Safari (and Chrome
 * with `interactive-widget=overlays-content`) keep the layout viewport and shrink only `visualViewport`, so fixed
 * layouts sized with `dvh` would end up under the keyboard. Browsers that resize the layout viewport report 0.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      // Ignore small differences (pinch zoom rounding, URL bar animation): a keyboard is never this short.
      setInset(covered > 80 ? covered : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return inset;
}
