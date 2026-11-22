import { describe, expect, it } from "vitest";

import { zoomAt, zoomForKey } from "@/lib/zoom";

describe("zoomForKey", () => {
  it("zooms in from the center and back out to none", () => {
    const zoomed = zoomForKey(null, "+");
    expect(zoomed).toEqual({ x: 50, y: 50, scale: 1.5 });
    expect(zoomForKey(zoomed!, "-")).toBeNull();
    expect(zoomForKey(zoomAt(10, 10, 4), "=")).toEqual({ x: 10, y: 10, scale: 4 });
  });

  it("pans only while zoomed, within the image", () => {
    expect(zoomForKey(null, "ArrowLeft")).toBeUndefined();
    expect(zoomForKey(zoomAt(5, 50), "ArrowLeft")).toEqual({ x: 0, y: 50, scale: 2 });
    expect(zoomForKey(zoomAt(50, 50), "ArrowDown")).toEqual({ x: 50, y: 60, scale: 2 });
  });

  it("resets on 0 and Escape and ignores other keys", () => {
    expect(zoomForKey(zoomAt(20, 20), "Escape")).toBeNull();
    expect(zoomForKey(zoomAt(20, 20), "0")).toBeNull();
    expect(zoomForKey(zoomAt(20, 20), "a")).toBeUndefined();
  });
});
