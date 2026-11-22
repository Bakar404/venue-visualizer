// @vitest-environment jsdom
// FX-R7: the keyboard inset only applies while a text field is focused and the page isn't pinch-zoomed.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useKeyboardInset } from "@/hooks/use-keyboard-inset";

class FakeViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  scale = 1;
}

let vv: FakeViewport;

function viewport(height: number, scale = 1) {
  vv.height = height;
  vv.scale = scale;
  act(() => vv.dispatchEvent(new Event("resize")));
}

beforeEach(() => {
  vv = new FakeViewport();
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });
});

afterEach(() => {
  document.body.innerHTML = "";
});

function field(tag: "input" | "textarea" | "button" = "input") {
  const el = document.createElement(tag);
  document.body.append(el);
  act(() => el.focus());
  return el;
}

describe("useKeyboardInset", () => {
  it("lifts the layout above the keyboard while a text field is focused", () => {
    const { result } = renderHook(() => useKeyboardInset());
    field("textarea");
    viewport(500);
    expect(result.current).toBe(344);
  });

  it("ignores a shrunk viewport when nothing is focused", () => {
    const { result } = renderHook(() => useKeyboardInset());
    viewport(500);
    expect(result.current).toBe(0);
  });

  it("ignores pinch zoom, even with a text field focused", () => {
    const { result } = renderHook(() => useKeyboardInset());
    field("input");
    viewport(422, 2);
    expect(result.current).toBe(0);
  });

  it("ignores a focused button (not a text field)", () => {
    const { result } = renderHook(() => useKeyboardInset());
    field("button");
    viewport(500);
    expect(result.current).toBe(0);
  });

  it("drops the inset when the field loses focus", () => {
    const { result } = renderHook(() => useKeyboardInset());
    const input = field("input");
    viewport(500);
    expect(result.current).toBe(344);
    act(() => input.blur());
    expect(result.current).toBe(0);
  });
});
