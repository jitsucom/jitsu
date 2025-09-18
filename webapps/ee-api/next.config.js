/** @type {import('next').NextConfig} */
module.exports =  {
  transpilePackages: ["juava"],
  experimental: {
    turbo: {
      rules: {
        '*.sql$': {
          loaders: ['raw-loader'],
          as: '*.js',
        },
      },
    },
  },
  reactStrictMode: true,
  swcMinify: true,
  webpack: (config, opts) => {
    // if (prevWebpack) {
    //   prevWebpack(config, opts);
    // }
    config.module.rules.push({
      test: /\.sql$/,
      use: "raw-loader",
    });
    return config;
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
        ],
      },
    ];
  },
};
