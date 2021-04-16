// tailwind.config.js
module.exports = {
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',

      bgPrimary: {
        DEFAULT: 'rgb(17, 24, 39)'
      },
      bgSecondary: {
        DEFAULT: 'rgb(31, 41, 55)'
      },
      bgComponent: {
        DEFAULT: 'rgb(26,35,50)'
      },
      bgTableHeader: {
        DEFAULT: '#394e5a'
      },
      splitBorder: {
        DEFAULT: '#394e5a'
      },
      primary: {
        DEFAULT: '#27a4fb'
      },
      link: {
        DEFAULT: 'rgb(135, 138, 252)'
      },
      success: {
        DEFAULT: '#2cc56f'
      },
      warning: {
        DEFAULT: '#ffc021'
      },
      error: {
        DEFAULT: '#e53935'
      },
      heading: {
        DEFAULT: '#c1c9d2'
      },
      text: {
        DEFAULT: '#e5e7eb'
      },
      secondaryText: {
        DEFAULT: '#7996a9'
      },
      disabled: {
        DEFAULT: '#415969'
      },
      secondaryBorder: {
        DEFAULT: '#415969'
      }
    }
  },
  corePlugins: {
    preflight: false
  },
  purge: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  darkMode: false, // or 'media' or 'class'
  variants: {
    extend: {}
  },
  plugins: []
}