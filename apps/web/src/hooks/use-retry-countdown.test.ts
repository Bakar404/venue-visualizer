// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useSecondsLeft } from "@/hooks/use-retry-countdown";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("reaches zero if the clock crosses the deadline during a tick", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const { result } = renderHook(() => useSecondsLeft(1250));
  act(() => vi.advanceTimersByTime(0));
  expect(result.current).toBe(1);

  const now = vi.spyOn(Date, "now").mockReturnValueOnce(1249).mockReturnValueOnce(1250);
  act(() => vi.advanceTimersByTime(250));
  now.mockRestore();
  act(() => vi.advanceTimersByTime(250));

  expect(result.current).toBe(0);
});
