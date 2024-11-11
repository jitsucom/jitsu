/** @type {import("next").NextConfig} */
const withTM = require("next-transpile-modules")([
  "juava",
  "@jitsu/protocols",
  "@jitsu/core-functions",
  "@ant-design/icons",
]);
const nextConfig = withTM({});
const path = require("path");

module.exports = nextConfig;

const prevWebpack = module.exports.webpack;

const packageRoot = path.join(__dirname, "../../");
console.log("packageRoot", packageRoot);
module.exports = {
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
  async headers() {
    //set cors headers
    return [
      {
        source: "/:path*{/}?",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
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
    if (prevWebpack) {
      prevWebpack(config, opts);
    }
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
    //    if (opts.isServer) {
    config.devtool = "source-map";
    //    }
    config.externals["isolated-vm"] = "require('isolated-vm')";
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
};
