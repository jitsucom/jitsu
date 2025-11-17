const path = require("path");
const webpack = require("webpack");

const config = {
  entry: "./src/index.ts",
  target: "node",
  externals: {
    "isolated-vm": "require('isolated-vm')",
    "@confluentinc/kafka-javascript": "require('@confluentinc/kafka-javascript')",
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
        exclude: /node_modules/,
        use: {
          loader: "swc-loader",
          options: {
            configFile: path.resolve(__dirname, "../../libs/common-config/swc.config.json"),
          },
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
