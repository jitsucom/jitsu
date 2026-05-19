/** @type {import('next').NextConfig} */
const path = require("path");
module.exports =  {
  transpilePackages: ["juava"],
  turbopack: {
    // See webapps/console/next.config.js for the rationale.
    root: path.resolve(__dirname, "../.."),
    rules: {
      "*.sql": {
        loaders: ["raw-loader"],
        as: "*.js",
      },
    },
  },
  // Allow portless dev hosts (https://ee[-branch].jitsu.localhost) to load
  // /_next/* resources. Without this Next 15+ blocks them as cross-origin.
  allowedDevOrigins: ["*.jitsu.localhost"],
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*{/}?",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
    ];
  },
};
