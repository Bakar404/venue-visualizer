// Next rewrites use a loopback connection to the API. Attest the original
// socket peer before Next handles the request, replacing any browser header.
const http = require("node:http");
const { createHmac } = require("node:crypto");
const { syncBuiltinESMExports } = require("node:module");

const key = process.env.VV_LAN_PROXY_KEY;
if (key) {
  const createServer = http.createServer;
  http.createServer = function (...args) {
    const server = createServer.apply(this, args);
    server.prependListener("request", (request) => {
      const ip = request.socket.remoteAddress;
      delete request.headers["x-vv-client"];
      if (ip) {
        const signature = createHmac("sha256", key).update(ip).digest("hex");
        request.headers["x-vv-client"] = `${ip}.${signature}`;
      }
    });
    return server;
  };
  syncBuiltinESMExports();
}
