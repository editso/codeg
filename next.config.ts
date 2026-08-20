import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const isProd = process.env.NODE_ENV === "production"
const isDev = process.env.NODE_ENV === "development"
const internalHost = process.env.TAURI_DEV_HOST || "localhost"
// Keep development requests same-origin so the browser app can use the Rust
// server without losing Fast Refresh or duplicating API-base handling.
const devBackendUrl = (
  process.env.CODEG_DEV_BACKEND_URL || "http://127.0.0.1:3080"
).replace(/\/+$/, "")
const withNextIntl = createNextIntlPlugin({
  requestConfig: "./src/i18n/request.ts",
  experimental: {
    messages: {
      path: "./src/i18n/messages",
      format: "json",
      locales: [
        "en",
        "zh-CN",
        "zh-TW",
        "ja",
        "ko",
        "es",
        "de",
        "fr",
        "pt",
        "ar",
      ],
      precompile: true,
    },
  },
})

const nextConfig: NextConfig = {
  // Static export is only meaningful for production. Leaving it out in
  // development permits the local API/WebSocket proxy without Next's
  // export-mode warning.
  ...(isProd ? { output: "export" } : {}),
  images: {
    unoptimized: true,
  },
  assetPrefix: isProd ? undefined : `http://${internalHost}:3000`,
  // `output: "export"` cannot use rewrites in production. Defining them
  // only for `next dev` keeps the production bundle fully static while the
  // development server proxies REST, uploads/downloads, and WebSockets.
  ...(isDev
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${devBackendUrl}/api/:path*`,
            },
            {
              source: "/ws/:path*",
              destination: `${devBackendUrl}/ws/:path*`,
            },
          ]
        },
      }
    : {}),
}

export default withNextIntl(nextConfig)
