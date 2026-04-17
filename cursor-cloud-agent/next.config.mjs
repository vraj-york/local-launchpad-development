const isDev = process.env.NODE_ENV === "development";

/** Suppress `GET /path 200 in Xms` lines unless CLR_DEV_HTTP_LOG=1 (e.g. `npm run dev -- --log`). */
const showDevHttpLog =
  process.env.CLR_DEV_HTTP_LOG === "1" || process.env.CLR_DEV_HTTP_LOG === "true";

const csp = isDev
  ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:"
  : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'";

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isDev && !showDevHttpLog ? { logging: { incomingRequests: false } } : {}),
  serverExternalPackages: ["sql.js"],
  /** Match Cursor Cloud API base path (`https://api.cursor.com/v0/...`) so clients can call `/v0/...` without `/api`. */
  async rewrites() {
    return [{ source: "/v0/:path*", destination: "/api/v0/:path*" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
