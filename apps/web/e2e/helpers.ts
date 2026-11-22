import path from "node:path";

import { expect, type Page } from "@playwright/test";

/** Screenshots for the proof folder at the repo root (`docs/proof/`). */
export const proof = (name: string) => path.resolve(__dirname, "../../../docs/proof", name);

type MockPeek = {
  looks: () => Array<{ id: string; space_id: string; name: string; spec: { linens: { color: string } } }>;
  renders: () => Array<{ id: string; look_id: string; photo_id: string; status: string }>;
  chat: (spaceId: string) => Array<{ role: "user" | "assistant"; content: string }>;
  /** The space's saved row; `current_spec` is the autosaved draft, exactly as the app sent it. */
  space: (spaceId: string) => { current_spec: Record<string, unknown> | null } | null;
  photos: (spaceId: string) => Array<{ id: string; kind: string; approved: boolean }>;
  /** Holds every later request of this kind until `release`; `waiting` counts the requests parked there. */
  hold: (name: MockGate) => void;
  release: (name: MockGate) => void;
  waiting: (name: MockGate) => number;
  /** The next request of this kind fails with a 500 and this message. */
  failNext: (name: MockGate, message: string) => void;
  /** Resets the simulated machine and settings (also `?vvScenario=` on any URL). Kept for the tab's session. */
  setScenario: (name: MockScenario) => void;
  /** Changes a tool on the simulated machine, like running its install or sign-in command. Seen after Check again. */
  install: (provider: MockProvider, state?: "ready" | "signed-out" | "missing") => void;
  settings: () => {
    default_brain: string | null;
    default_engine: string | null;
    allow_web_research: boolean;
    setup_completed_at: string | null;
    providers: Record<string, Record<string, string | null> | undefined>;
    lan: { enabled: boolean };
  };
  /** Like restarting the app with `make dev-lan` (true) or `make dev` (false). Settings can't change it. */
  setLan: (enabled: boolean) => void;
  /** Phones paired with this computer, as `GET /api/system/lan/devices` returns them. */
  lanDevices: () => Array<{ id: string; label: string; paired_at: string; last_seen: string; expires_at: string }>;
  /** Adds a paired phone directly, as if it had paired through /pair. */
  pairPhone: (label?: string) => void;
  /** The next backend test is refused with HTTP 429 and `Retry-After: seconds`; tests stay refused until then. */
  rateLimitTests: (seconds: number) => void;
  clearTests: () => void;
  /** Who is calling the mock API: this computer ("owner") or a phone on the LAN, paired or not. */
  setClient: (client: "owner" | "phone", paired?: boolean) => void;
  client: () => { client: "owner" | "phone"; paired: boolean };
  /** Too many wrong pairing codes: pairing is paused for `seconds` and there is no code. */
  lockPairing: (seconds: number) => void;
  /** The current pairing code expires now. */
  expirePairingCode: () => void;
};

export type MockScenario = "fresh" | "signed-out" | "ready" | "demo";
type MockProvider = "claude" | "codex" | "copilot" | "kimi" | "mflux";

type MockGate = "chat" | "renderLook" | "deletePhoto" | "getJob" | "setupStatus" | "pairDevice" | "testBackend";

/** Turns phone access on (like `make dev-lan`) and returns the pairing code Setup shows on the computer. */
export async function lanCode(page: Page) {
  await page.goto("/setup");
  await mockReady(page);
  await page.evaluate(() => window.__vvMock.setLan(true));
  await page.reload();
  const code = page.getByTestId("pairing-code");
  await expect(code).toHaveText(/^\d{3} \d{3}$/);
  return ((await code.textContent()) ?? "").replace(/\D/g, "");
}

/**
 * Waits until the app has loaded the mock, attached `window.__vvMock`, and dropped `?vvScenario=` from the URL.
 * Until then a reload would re-apply the scenario and undo whatever the test just changed (slow CI machines hit this).
 */
export async function mockReady(page: Page) {
  await page.waitForFunction(() => "__vvMock" in window && !new URLSearchParams(window.location.search).has("vvScenario"));
}

/** Holds `name` requests in the mock; returns a release function. */
export async function holdMock(page: Page, name: MockGate) {
  await page.evaluate((n) => window.__vvMock.hold(n), name);
  return {
    /** Resolves once a request has reached the hold. */
    reached: () => expect.poll(() => page.evaluate((n) => window.__vvMock.waiting(n), name)).toBeGreaterThan(0),
    release: () => page.evaluate((n) => window.__vvMock.release(n), name),
  };
}

/** The space's autosaved plan in the mock database. */
export function savedSpec(page: Page, spaceId: string) {
  return page.evaluate((id) => window.__vvMock.space(id)?.current_spec ?? null, spaceId);
}

declare global {
  interface Window {
    __vvMock: MockPeek;
  }
}

export async function openStudio(page: Page, spaceId: string, query = "") {
  await page.goto(`/spaces/${spaceId}${query}`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#chat-input")).toBeAttached();
}

/** Counts finished assistant bubbles in the conversation log. */
export function assistantReplies(page: Page) {
  return page.evaluate(
    () => [...document.querySelectorAll('[role="log"] li')].filter((li) => li.textContent?.trimStart().startsWith("Assistant:")).length,
  );
}

/** The text of the newest user bubble, without the screen-reader prefix. */
export function lastUserMessage(page: Page) {
  return page.evaluate(() => {
    const mine = [...document.querySelectorAll('[role="log"] li')].filter((li) => li.textContent?.trimStart().startsWith("You:"));
    return (mine.at(-1)?.querySelector("p")?.textContent ?? "").replace(/^You:\s*/, "");
  });
}

/** Waits until one more assistant reply is on screen. */
export async function waitForReply(page: Page, before: number) {
  await expect.poll(() => assistantReplies(page), { timeout: 10_000 }).toBe(before + 1);
}

/** True once an assistant reply follows the newest user bubble with this text. */
function repliedTo(page: Page, text: string) {
  return page.evaluate((sent) => {
    const items = [...document.querySelectorAll('[role="log"] li')].map((li) => li.textContent?.trimStart() ?? "");
    const mine = items.findLastIndex((t) => t.startsWith("You:") && t.replace(/^You:\s*/, "").startsWith(sent));
    return mine >= 0 && items.slice(mine + 1).some((t) => t.startsWith("Assistant:"));
  }, text);
}

export async function sendChat(page: Page, text: string) {
  const input = page.locator("#chat-input");
  await input.fill(text);
  await input.press("Enter");
  await expect.poll(() => repliedTo(page, text), { timeout: 10_000 }).toBe(true);
}

/** Waits for running CSS transitions/animations so screenshots show the settled state. */
export async function settled(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
}
