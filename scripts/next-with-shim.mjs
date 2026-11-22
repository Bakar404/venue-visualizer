#!/usr/bin/env node
// Runs `next dev` or `next start` (from the current package) with services/api/lan_proxy.cjs preloaded through
// NODE_OPTIONS, so every Next.js process attests the browser's address to the API. Without it the API treats
// every proxied request as remote.
//
//   node ../../scripts/next-with-shim.mjs dev|start --hostname <host> [other next options]
//
// The web binds to the network only in LAN mode (`make dev-lan`, which sets VV_LAN=1 and VV_LAN_PROXY_KEY), and
// then only as `next start`: the dev server never listens beyond loopback.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { constants } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shim = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "services", "api", "lan_proxy.cjs");
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function fail(message) {
  console.error(`next-with-shim: ${message}`);
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);
if (command !== "dev" && command !== "start") fail("usage: next-with-shim.mjs dev|start --hostname <host> [options]");

const hostnames = new Set();
for (let i = 0; i < args.length; i++) {
  const match = /^(?:--hostname|-H)(?:=(.*))?$/.exec(args[i]);
  if (match) hostnames.add(match[1] ?? args[++i] ?? "");
}
if (hostnames.size !== 1) {
  fail(`pass exactly one --hostname (got ${hostnames.size ? [...hostnames].join(", ") : "none"}).`);
}
const [hostname] = hostnames;
if (!LOOPBACK.has(hostname) && command === "dev") {
  fail(`refusing to serve the Next dev server on ${hostname}: its /_next/mcp endpoint, HMR and overlays must ` +
    "never reach the network. LAN mode serves a production build with `next start` (`make dev-lan`).");
}
if (!LOOPBACK.has(hostname) && (process.env.VV_LAN !== "1" || !process.env.VV_LAN_PROXY_KEY)) {
  fail(`refusing --hostname ${hostname}: outside LAN mode the web listens on 127.0.0.1 only. ` +
    "Use `make dev-lan` to open the app on your phone.");
}

let next;
try {
  next = createRequire(path.join(process.cwd(), "package.json")).resolve("next/dist/bin/next");
} catch {
  fail("can't find the `next` package; run this from apps/web after `pnpm install`.");
}

// NODE_OPTIONS reaches every Next.js worker process. Quote the path in case it contains spaces.
const requireShim = `--require="${shim.replace(/["\\]/g, "\\$&")}"`;
const env = { ...process.env, NODE_OPTIONS: [requireShim, process.env.NODE_OPTIONS ?? ""].join(" ").trim() };
const child = spawn(process.execPath, [next, command, ...args], { stdio: "inherit", env });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  process.exit(code ?? 128 + (constants.signals[signal] ?? 1));
});
