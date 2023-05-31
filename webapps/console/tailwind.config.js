const theme = require("./theme.config.js");

const disabledCss = {
  "code::before": false,
  "code::after": false,
  "blockquote p:first-of-type::before": false,
  "blockquote p:last-of-type::after": false,
  pre: false,
  code: false,
  "h2 code": false,
  "pre code": false,
};

module.exports = {
  content: ["./pages/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      transitionProperty: {
        'width': 'width'
      },
      typography: {
        DEFAULT: { css: disabledCss },
        sm: { css: disabledCss },
        lg: { css: disabledCss },
        xl: { css: disabledCss },
        "2xl": { css: disabledCss },
      },
      colors: {
        transparent: "ttailansparent",
        current: "currentColor",
        ...Object.entries(theme)
          .map(([name, color]) => ({ [name]: { DEFAULT: color } }))
          .reduce((acc, cur) => ({ ...acc, ...cur }), {}),
      },
      fontSize: {
        "3xs": "0.5rem",
        xxs: "0.7rem",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
