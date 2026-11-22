import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebouncer } from "@/hooks/debouncer";

describe("createDebouncer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs only the last call after the delay", () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 100);
    d(1);
    d(2);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("flush runs the pending call immediately, once", () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 100);
    d("draft");
    expect(d.pending()).toBe(true);
    d.flush();
    d.flush();
    vi.runAllTimers();
    expect(fn).toHaveBeenCalledExactlyOnceWith("draft");
    expect(d.pending()).toBe(false);
  });

  it("cancel drops the pending call", () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 100);
    d("stale");
    d.cancel();
    vi.runAllTimers();
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls the latest function", () => {
    const first = vi.fn();
    const second = vi.fn();
    const d = createDebouncer(first, 100);
    d();
    d.setFn(second);
    vi.runAllTimers();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
