const path = require("path");
const webpack = require("webpack");

const config = {
  entry: "./src/index.ts",
  target: "node",
  externals: {
    "isolated-vm": "require('isolated-vm')",
    "@sensejs/kafkajs-zstd-support": "require('@sensejs/kafkajs-zstd-support')",
    "@mongodb-js/zstd": "require('@mongodb-js/zstd')",
  },
  node: {
    __dirname: false,
  },
  devtool: "source-map",
  output: {
    path: path.resolve(__dirname, "dist"),
  },
  plugins: [
    new webpack.IgnorePlugin({ resourceRegExp: /^pg-native$/ }), // Ignore native module
    // Add your plugins here
    // Learn more about plugins from https://webpack.js.org/configuration/plugins/
  ],
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/i,
        //loader: "ts-loader",
        //exclude: ["/node_modules/"],
        use: {
          loader: "babel-loader",
        },
      },
      {
        test: /\.node$/,
        loader: "node-loader",
      },
    ],
  },
  optimization: {
    minimize: false,
  },
  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js", ".node", "..."],
  },
  mode: "production",
};

module.exports = () => config;
