// Preloaded into every Next.js process by scripts/next-with-shim.mjs (`pnpm --filter web dev|start`, the
// Make targets, Playwright). Next rewrites reach the API over a loopback connection, so the API can't tell
// who the browser is. Attest the original socket peer before Next handles the request, replacing any
// X-VV-Client the browser sent, with an HMAC the API checks (see RequestPolicy in services/api/main.py).
//
// Key: VV_LAN_PROXY_KEY (per run, `make dev-lan`), otherwise <VV_DATA_DIR or repo data/>/.vv-proxy-key,
// created here (32 random bytes as hex, mode 0600) if the web starts before the API.
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createHmac, randomBytes } = require("node:crypto");
const { syncBuiltinESMExports } = require("node:module");

const KEY_FILE = ".vv-proxy-key";
const KEY_PATTERN = /^[0-9a-f]{64}$/;

function keyFile(env) {
  let dir = env.VV_DATA_DIR;
  if (dir && (dir === "~" || dir.startsWith("~/"))) dir = path.join(env.HOME || os.homedir(), dir.slice(1));
  // Same default as services/api/config.py: <repo>/data. Use an absolute VV_DATA_DIR: the API and the web
  // run from different folders, so a relative one would name two different places.
  return path.join(path.resolve(dir || path.join(__dirname, "..", "..", "data")), KEY_FILE);
}

function readKey(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (fs.fstatSync(fd).mode & 0o077) fs.fchmodSync(fd, 0o600);
    const value = fs.readFileSync(fd, "ascii").trim();
    if (!KEY_PATTERN.test(value)) throw new Error(`${file} is not a valid proxy key; delete it and restart`);
    return value;
  } finally {
    fs.closeSync(fd);
  }
}

function sharedKey(file) {
  try {
    return readKey(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // Write a private temporary file, then hard-link it into place: the first writer wins and nobody reads a
  // partial key (the API does the same in services/api/lan.py).
  const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
  try {
    fs.linkSync(temporary, file);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return readKey(file);
}

function loadKey(env) {
  if (env.VV_LAN_PROXY_KEY) return env.VV_LAN_PROXY_KEY;
  try {
    return sharedKey(keyFile(env));
  } catch (error) {
    // Without a key nothing is attested, so the API treats every proxied request as remote (fails closed).
    console.warn(`[venue-visualizer] Can't load the proxy key: ${error.message}`);
    return null;
  }
}

const key = loadKey(process.env);
if (key && !http.createServer.vvAttests) {
  const createServer = http.createServer;
  const attest = (request) => {
    const ip = request.socket.remoteAddress;
    delete request.headers["x-vv-client"];
    if (ip) {
      const signature = createHmac("sha256", key).update(ip).digest("hex");
      request.headers["x-vv-client"] = `${ip}.${signature}`;
    }
  };
  http.createServer = function (...args) {
    const server = createServer.apply(this, args);
    server.prependListener("request", attest);
    server.prependListener("upgrade", attest);
    return server;
  };
  http.createServer.vvAttests = true;
  syncBuiltinESMExports();
}

module.exports = { keyFile };
