const path = require("path")
const fs = require("fs")
const CracoLessPlugin = require("craco-less")
const BundleAnalyzerPlugin = require("webpack-bundle-analyzer").BundleAnalyzerPlugin
const CracoAntDesignPlugin = require("craco-antd")
const CracoBabelLoader = require("craco-babel-loader")
const TerserPlugin = require("terser-webpack-plugin")
const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin")
const webpack = require("webpack")
const DEV_PORT = process.env.DEV_PORT || "9876"
const DEV_HOST = process.env.DEV_HOST || "localhost"

// manage relative paths to packages
const appDirectory = fs.realpathSync(process.cwd())
const resolvePackage = relativePath => path.resolve(appDirectory, relativePath)

module.exports = {
  eslint: {
    enable: false,
  },
  devServer: {
    host: DEV_HOST,
    port: DEV_PORT,
    hot: true,
    historyApiFallback: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "X-Requested-With, content-type, Authorization",
    },
    compress: true,
    overlay: {
      warnings: false,
      errors: true,
    },
    contentBase: __dirname + "/public",
  },
  babel: {
    loaderOptions: {
      babelrc: true,
    },
  },
  webpack: {
    plugins: [
      new webpack.DefinePlugin({
        "process.env": {
          GIT_HEAD: JSON.stringify(process.env.HEAD || null),
          GIT_BRANCH: JSON.stringify(process.env.BRANCH || null),
          GIT_COMMIT_REF: JSON.stringify(process.env.COMMIT_REF || null),
          BUILD_TIMESTAMP: JSON.stringify(new Date().toISOString()),
          BUILD_ID: JSON.stringify(process.env.BUILD_ID || null),
          BACKEND_API_BASE: JSON.stringify(process.env.BACKEND_API_BASE),
          NODE_ENV: JSON.stringify(process.env.NODE_ENV || "production"),
          ANALYTICS_KEYS: JSON.stringify(process.env.ANALYTICS_KEYS || null),
          APP_PATH: JSON.stringify(process.env.APP_PATH || ""),
          FIREBASE_CONFIG: JSON.stringify(process.env.FIREBASE_CONFIG || null),
          BILLING_API_BASE_URL: JSON.stringify(process.env.BILLING_API_BASE_URL || null),
          OAUTH_BACKEND_API_BASE: JSON.stringify(process.env.OAUTH_BACKEND_API_BASE || null),
          SLACK_API_URL: JSON.stringify(process.env.SLACK_API_URL || null),
          JITSU_NEXT_EE_URL: JSON.stringify(process.env.JITSU_NEXT_EE_URL || null),
          JITSU_NEXT_URL: JSON.stringify(process.env.JITSU_NEXT_URL || null),
        },
      }),
      new BundleAnalyzerPlugin({
        analyzerMode: "static",
        openAnalyzer: false,
        reportFilename: "bundle-report.html",
      }),
      new MonacoWebpackPlugin({
        languages: ["json", "javascript", "typescript", "html"],
      }),
    ],
    configure: (webpackConfig, { env, paths }) => {
      const miniCssExtractPlugin = webpackConfig.plugins.find(
        plugin => plugin.constructor.name === "MiniCssExtractPlugin"
      )

      if (miniCssExtractPlugin) {
        miniCssExtractPlugin.options.ignoreOrder = true
      }

      return {
        ...webpackConfig,
        resolve: { ...webpackConfig.resolve, modules: ["../node_modules", ...webpackConfig.resolve.modules] },
        optimization: {
          runtimeChunk: false,
          splitChunks: {
            chunks: "all",
            maxSize: 240_000,
          },
          minimize: process.env.ENV === "production",
          minimizer: [
            new TerserPlugin({
              terserOptions: {
                keep_classnames: true,
              },
            }),
          ],
        },
      }
    },
  },
  style: {
    postcss: {
      plugins: [require("tailwindcss"), require("autoprefixer")],
    },
  },
  plugins: [
    // {
    //   // transpile some of the node_modules using babel
    //   plugin: CracoBabelLoader,
    //   options: {
    //     includes: [resolvePackage("../node_modules/@jitsu/catalog"), resolvePackage("../catalog")],
    //   },
    // },
    {
      plugin: CracoAntDesignPlugin,
      options: {
        customizeThemeLessPath: path.join(__dirname, "src/theme.less"),
      },
    },
    {
      plugin: CracoLessPlugin,
      options: {
        cssLoaderOptions: {
          modules: { localIdentName: "[local]_[hash:base64:5]" },
        },
        modifyLessRule: function (lessRule, _context) {
          lessRule.test = /\.(module)\.(less)$/
          lessRule.exclude = path.join(__dirname, "node_modules")
          return lessRule
        },
      },
    },
  ],
}
