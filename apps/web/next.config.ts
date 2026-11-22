import type { NextConfig } from "next";

const apiUrl = (process.env.VV_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@vv/schema", "@vv/scene"],
  experimental: {
    // Rewrites to the API go through Next's proxy, which buffers request bodies up to this
    // limit (default 10 MB, then silently truncates) and times out after 30 s by default.
    // Video tours are up to 1 GB, so allow a little headroom for multipart overhead.
    proxyClientMaxBodySize: Math.round(1.1 * 1024 ** 3),
    proxyTimeout: 600_000,
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
      { source: "/files/:path*", destination: `${apiUrl}/files/:path*` },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
