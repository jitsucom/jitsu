module.exports = {
  presets: [
    "@babel/preset-env",
    "@babel/preset-typescript",
    ["@babel/preset-react", { importSource: "react", runtime: "automatic" }],
  ],
  plugins: [],
};
