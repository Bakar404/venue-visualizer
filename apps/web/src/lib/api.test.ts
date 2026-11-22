import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, httpApi } from "@/lib/api";

function respond(status: number, headers: Record<string, string> = {}, body: unknown = { detail: "Too many tests" }) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers })));
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("Expected the request to fail");
}

describe("HTTP 429 from a backend test", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("carries Retry-After in seconds", async () => {
    respond(429, { "Retry-After": "7" });
    const error = await failure(httpApi.testBackend("brain", "claude", {}));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, retryAfter: 7, message: "Too many tests" });
  });

  it("reads an HTTP-date Retry-After as seconds from now", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
    respond(429, { "Retry-After": "Sat, 21 Nov 2026 12:00:12 GMT" });
    expect((await failure(httpApi.testBackend("brain", "claude", {}))).retryAfter).toBe(12);
  });

  it("leaves retryAfter unset without a usable header", async () => {
    respond(429, { "Retry-After": "soon" });
    expect((await failure(httpApi.testBackend("brain", "claude", {}))).retryAfter).toBeUndefined();
    respond(500);
    expect((await failure(httpApi.testBackend("brain", "claude", {}))).retryAfter).toBeUndefined();
  });
});
