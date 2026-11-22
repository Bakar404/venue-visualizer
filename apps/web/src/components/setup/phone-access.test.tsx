// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { PhoneAccess } from "@/components/setup/phone-access";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { LanInfo } from "@/lib/types";

const oldCode: LanInfo = {
  enabled: true, url: null, qr_svg: null, pairing_code: "123456", pairing_required: true, pairing_expires_in: 1,
};
const newCode = { ...oldCode, pairing_code: "654321", pairing_expires_in: 600 };

async function openPhoneAccess() {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const get = vi.spyOn(api, "lanInfo").mockResolvedValue(oldCode);
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
