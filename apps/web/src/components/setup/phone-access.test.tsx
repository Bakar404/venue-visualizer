// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { PhoneAccess } from "@/components/setup/phone-access";
import { api } from "@/lib/api";
import { qk, useLanInfo } from "@/lib/queries";
import type { LanInfo } from "@/lib/types";

const oldCode: LanInfo = {
  enabled: true, url: null, qr_svg: null, pairing_code: "123456", pairing_required: true, pairing_expires_in: 1,
};
const newCode = { ...oldCode, pairing_code: "654321", pairing_expires_in: 600 };

async function openPhoneAccess(info = oldCode) {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const get = vi.spyOn(api, "lanInfo").mockResolvedValue(info);
  vi.spyOn(api, "lanDevices").mockResolvedValue([]);
  const post = Promise.withResolvers<LanInfo>();
  const rotate = vi.spyOn(api, "rotateLanCode").mockReturnValue(post.promise);
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><PhoneAccess /></QueryClientProvider>);
  await tick(20);
  expect(screen.getByTestId("pairing-code").textContent).toBe("123 456");
  return { client, get, post, rotate };
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("does not fetch at expiry while a new code is pending", async () => {
  const { get, post, rotate } = await openPhoneAccess();
  fireEvent.click(screen.getByRole("button", { name: "New code" }));
  await tick(1250);

  expect(rotate).toHaveBeenCalledOnce();
  expect(screen.getByTestId("pairing-expiry").textContent).toBe("Expires in 0:00");
  expect(get).toHaveBeenCalledOnce();
  post.resolve(newCode);
  await tick(20);
  expect(screen.getByTestId("pairing-code").textContent).toBe("654 321");
});

it("keeps the new code when an in-flight LAN query returns the old code", async () => {
  const { client, get, post } = await openPhoneAccess();
  const stale = Promise.withResolvers<LanInfo>();
  get.mockReturnValueOnce(stale.promise);
  fireEvent.click(screen.getByRole("button", { name: "New code" }));
  await tick(20);
  void client.refetchQueries({ queryKey: qk.lan, exact: true });
  expect(get).toHaveBeenCalledTimes(2);

  post.resolve(newCode);
  await tick(20);
  expect(screen.getByTestId("pairing-code").textContent).toBe("654 321");
  stale.resolve(oldCode);
  await tick(20);
  expect(screen.getByTestId("pairing-code").textContent).toBe("654 321");
});

it("keeps showing the pairing code after a background poll fails", async () => {
  const { client, get } = await openPhoneAccess({ ...oldCode, pairing_expires_in: 600 });
  get.mockRejectedValue(new Error("API restarting"));
  await tick(6200);

  expect(client.getQueryState(qk.lan)?.status).toBe("error");
  expect(screen.queryByTestId("pairing-code")?.textContent).toBe("123 456");
  expect(screen.queryByText(/couldn.t check phone access/i)).toBeNull();
});

it("shows a phone access error when the first request fails", async () => {
  vi.useFakeTimers();
  vi.spyOn(api, "lanInfo").mockRejectedValue(new Error("API unavailable"));
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><PhoneAccess /></QueryClientProvider>);
  await tick(1200);

  expect(screen.getByRole("alert").textContent).toContain("API unavailable");
});

it("does not poll LAN info when phone access is off", async () => {
  vi.useFakeTimers();
  const get = vi.spyOn(api, "lanInfo").mockResolvedValue({
    ...oldCode, enabled: false, pairing_code: null, pairing_expires_in: null,
  });
  const client = new QueryClient();
  const { result } = renderHook(() => useLanInfo(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await tick(20);
  expect(result.current.data?.enabled).toBe(false);

  await tick(15_000);
  expect(get).toHaveBeenCalledOnce();
});
