const path = require('path');
const CracoLessPlugin = require('craco-less');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin
const CracoAntDesignPlugin = require('craco-antd');
const TerserPlugin = require('terser-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const webpack = require('webpack');
const DEV_PORT = process.env.DEV_PORT || '9876';
const DEV_HOST = process.env.DEV_HOST || 'localhost';

module.exports = {
  eslint: {
    enable: false
  },
  devServer: {
    host: DEV_HOST,
    port: DEV_PORT,
    // proxy: process.env.PROXY_BACKEND ? ({
    //   '/api': {
    //     target: `${process.env.PROXY_BACKEND}/api`,
    //     secure: false,
    //     changeOrigin: true
    //
    //   }
    // }) : [] ,
    hot: true,
    historyApiFallback: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers':
        'X-Requested-With, content-type, Authorization'
    },
    compress: true,
    overlay: {
      warnings: false,
      errors: true
    },
    contentBase: __dirname + '/public'
  },
  webpack: {
    plugins: [
      new webpack.DefinePlugin({
        'process.env': {
          GIT_HEAD: JSON.stringify(process.env.HEAD || null),
          GIT_BRANCH: JSON.stringify(process.env.BRANCH || null),
          GIT_COMMIT_REF: JSON.stringify(process.env.COMMIT_REF || null),
          BUILD_TIMESTAMP: JSON.stringify(new Date().toISOString()),
          BUILD_ID: JSON.stringify(process.env.BUILD_ID || null),
          //          BACKEND_API_BASE: JSON.stringify(process.env.PROXY_BACKEND ? `http://${DEV_HOST}:${DEV_PORT}` : process.env.BACKEND_API_BASE),
          BACKEND_API_BASE: JSON.stringify(process.env.BACKEND_API_BASE),
          NODE_ENV: JSON.stringify(process.env.NODE_ENV || 'production'),
          ANALYTICS_KEYS: JSON.stringify(process.env.ANALYTICS_KEYS || null),
          APP_PATH: JSON.stringify(process.env.APP_PATH || ''),
          FIREBASE_CONFIG: JSON.stringify(process.env.FIREBASE_CONFIG || null),
          BILLING_API_BASE_URL: JSON.stringify(
            process.env.BILLING_API_BASE_URL || null
          )
        }
      }),
      new BundleAnalyzerPlugin({
        analyzerMode: 'static',
        openAnalyzer: false,
        reportFilename: 'bundle-report.html'
      }),
      new MonacoWebpackPlugin({
        languages: ['json', 'javascript', 'typescript']
      })
    ],
    configure: (webpackConfig, { env, paths }) => {
      const miniCssExtractPlugin = webpackConfig.plugins.find(
        (plugin) => plugin.constructor.name === 'MiniCssExtractPlugin'
      );

      if (miniCssExtractPlugin) {
        miniCssExtractPlugin.options.ignoreOrder = true;
      }

      return {
        ...webpackConfig,
        optimization: {
          runtimeChunk: false,
          splitChunks: {
            chunks: 'all',
            maxSize: 240_000
          },
          minimize: process.env.ENV === 'production',
          minimizer: [
            new TerserPlugin({
              terserOptions: {
                keep_classnames: true
              }
            })
          ]
        }
      };
    }
  },
  style: {
    postcss: {
      plugins: [require('tailwindcss'), require('autoprefixer')]
    }
  },
  plugins: [
    {
      plugin: CracoAntDesignPlugin,
      options: {
        customizeThemeLessPath: path.join(__dirname, 'src/theme.less')
      }
    },
    {
      plugin: CracoLessPlugin,
      options: {
        cssLoaderOptions: {
          modules: { localIdentName: '[local]_[hash:base64:5]' }
        },
        modifyLessRule: function (lessRule, _context) {
          lessRule.test = /\.(module)\.(less)$/;
          lessRule.exclude = path.join(__dirname, 'node_modules');
          return lessRule;
        }
      }
    }
  ]
};
