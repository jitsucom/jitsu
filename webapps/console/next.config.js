/** @type {import("next").NextConfig} */
const withTM = require("next-transpile-modules")(["juava", "@jitsu/protocols", "@jitsu/core-functions"]);
const nextConfig = withTM({});
const path = require("path");
module.exports = nextConfig;

const prevWebpack = module.exports.webpack;

const packageRoot = path.join(__dirname, "../../");
console.log("packageRoot", packageRoot);
module.exports = {
  experimental: {
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
  },
  outputFileTracing: true,
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
    config.externals.vm2 = "require('vm2')";
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
