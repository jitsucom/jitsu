/** @type {import("next").NextConfig} */

// In next.config.js (build-time config), we use process.env directly since this runs during build
// The serverEnv module with validation is for runtime (API routes, server-side rendering)
const path = require("path");
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

module.exports = withBundleAnalyzer({
  poweredByHeader: false,
  transpilePackages: ["juava", "@jitsu/protocols", "@jitsu/core-functions-lib", "@jitsu/destination-functions", "@jitsu-internal/webapps-shared", "@jitsu/js"],
  // Allow portless dev hosts (https://console[-branch].jitsu.localhost) to
  // load /_next/* resources. Without this Next 15+ blocks them as cross-origin.
  allowedDevOrigins: ["*.jitsu.localhost"],
  turbopack: {
    // Pin the workspace root to this repo (the worktree). Without this Next.js
    // walks up looking for a lockfile and on a worktree picks up the main
    // checkout's pnpm-workspace.yaml, which makes Turbopack's module graph
    // panic ("there must be a path to a root").
    root: path.resolve(__dirname, "../.."),
    rules: {
      "*.txt": {
        loaders: ["raw-loader"],
        as: "*.js",
      },
      "*.sql": {
        loaders: ["raw-loader"],
        as: "*.js",
      },
    },
  },
  // modularizeImports: {
  //   // "lucide-react": {
  //   //   transform: "Use <JLucideIcon name=\"{{ kebabCase member }}\" /> instead of importing from 'lucide-react'",
  //   //   preventFullImport: true,
  //   // },
  //   lodash: {
  //     transform: "lodash/{{member}}",
  //     preventFullImport: true,
  //   },
  //   "@ant-design/icons": {
  //     transform: "@ant-design/icons/{{member}}",
  //     preventFullImport: true,
  //   },
  //   "react-icons/(\\w+)": {
  //     transform: "@react-icons/all-files/{{ matches.[1] }}/{{member}}",
  //     preventFullImport: true,
  //     skipDefaultConversion: true,
  //   },
  // },
  async rewrites() {
    // Expose the MCP server and OAuth endpoints at top-level paths (not under
    // /api/) so MCP clients see natural URLs. Next.js Pages Router only treats
    // pages/api/* as API handlers, so the public paths are rewritten to
    // internal /api/mcp/* routes. /oauth/authorize is a regular Next page
    // (pages/oauth/authorize.tsx) so it doesn't need a rewrite.
    return [
      { source: "/mcp", destination: "/api/mcp/mcp" },
      { source: "/mcp/:path*", destination: "/api/mcp/:path*" },
      { source: "/oauth/register", destination: "/api/mcp/oauth/register" },
      { source: "/oauth/token", destination: "/api/mcp/oauth/token" },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/mcp/well-known/oauth-authorization-server",
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/mcp/well-known/oauth-protected-resource",
      },
    ];
  },
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
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
  outputFileTracingExcludes: {
    "*": [
      "./**/node_modules/@swc/core-linux-x64-gnu",
      "./**/node_modules/@swc/core-linux-x64-musl",
      "./**/node_modules/esbuild/linux",
      "./**/node_modules/webpack",
      "./**/node_modules/rollup",
      "./**/node_modules/terser",
    ],
  },
  ...(process.env.NEXTJS_STANDALONE_BUILD === "1"
    ? {
        output: "standalone",
      }
    : {}),
  webpack: (config, opts) => {
    // Fixes npm packages that depend on `fs` and 'dns' module
    if (!opts.isServer) {
      config.resolve.fallback = {
        util: false,
        fs: false,
        process: false,
        buffer: false,
        assert: false,
      };
      config.plugins.push(new opts.webpack.IgnorePlugin({ resourceRegExp: /^mongodb$/ }));
      config.plugins.push(new opts.webpack.IgnorePlugin({ resourceRegExp: /^posthog-node$/ }));
    }
    if (!opts.dev) {
      config.devtool = "source-map";
    }
    config.module.rules.push({
      test: /\.sql$/,
      use: "raw-loader",
    });
    config.module.rules.push({
      test: /\.txt$/,
      use: "raw-loader",
    });
    config.module.rules.push({
      test: /\.node$/,
      loader: "node-loader",
    });
    config.resolve.extensions.push(".node");
    return config;
  },
});
