// tailwind.config.js
module.exports = {
  theme: {
    fontSize: {
      '3xs': '0.5rem',
      xxs: '0.7rem',
      xs: '.75rem',
      sm: '.875rem',
      base: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      '2xl': '1.5rem',
      '3xl': '1.875rem',
      '4xl': '2.25rem',
      '5xl': '3rem',
      '6xl': '4rem',
      '7xl': '5rem'
    },
    colors: {
      transparent: 'ttailansparent',
      current: 'currentColor',

      bgPrimary: {
        DEFAULT: 'rgb(17, 24, 39)'
      },
      bgSecondary: {
        DEFAULT: 'rgb(31, 41, 55)'
      },
      bgComponent: {
        DEFAULT: 'rgb(26,35,50)' //#1a2332
      },
      bgTableHeader: {
        DEFAULT: '#394e5a'
      },
      splitBorder: {
        DEFAULT: '#394e5a'
      },
      primary: {
        DEFAULT: 'rgb(91, 20, 250)' //#5b14fa
      },
      primaryHover: {
        DEFAULT: 'rgb(65, 6, 212)' //#4106d4
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
      textPale: {
        DEFAULT: '#ffffff'
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