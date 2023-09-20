const path = require("path");

const config = {
  entry: "./src/index.ts",
  target: "node",
  externals: {
    figlet: "require('figlet')",
    "@swc/core": "require('@swc/core')",
    "@swc/wasm": "require('@swc/wasm')",
    vm2: "require('vm2')",
    "jest-cli": "require('jest-cli')",
    "../../package.json": "require('../package.json')",
  },
  node: {
    __dirname: false,
  },
  devtool: "source-map",
  output: {
    path: path.resolve(__dirname, "dist"),
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/i,
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
