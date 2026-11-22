/** Synced compare-view zoom: a focal point in percent plus a scale. `null` means not zoomed. */
export type Zoom = { x: number; y: number; scale: number } | null;

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const ZOOM_DEFAULT = 2;
const ZOOM_STEP = 0.5;
const PAN_STEP = 10;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function zoomAt(x: number, y: number, scale = ZOOM_DEFAULT): Zoom {
  return { x: clamp(x, 0, 100), y: clamp(y, 0, 100), scale: clamp(scale, ZOOM_MIN, ZOOM_MAX) };
}

/** Next zoom state for a key press, or `undefined` when the key isn't a zoom control. */
export function zoomForKey(zoom: Zoom, key: string): Zoom | undefined {
  const current = zoom ?? { x: 50, y: 50, scale: ZOOM_MIN };
  switch (key) {
    case "+":
    case "=":
      return zoomAt(current.x, current.y, current.scale + ZOOM_STEP);
    case "-":
    case "_": {
      const scale = current.scale - ZOOM_STEP;
      return scale <= ZOOM_MIN ? null : zoomAt(current.x, current.y, scale);
    }
    case "0":
    case "Escape":
      return null;
    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowDown": {
      if (!zoom) return undefined;
      const dx = key === "ArrowLeft" ? -PAN_STEP : key === "ArrowRight" ? PAN_STEP : 0;
      const dy = key === "ArrowUp" ? -PAN_STEP : key === "ArrowDown" ? PAN_STEP : 0;
      return zoomAt(zoom.x + dx, zoom.y + dy, zoom.scale);
    }
    default:
      return undefined;
  }
}
