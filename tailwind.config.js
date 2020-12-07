const colors = require('tailwindcss/colors')
const { spacing, fontWeight, borderRadius } = require('tailwindcss/defaultTheme')

const noMargin = { marginTop: 0, marginBottom: 0 }

module.exports = {
  purge: [
    'pages/**/*.html',
    '_layouts/**/*.html',
    '_includes/**/*.html',
  ],
  darkMode: false,
  theme: {
    colors: {
      gray: colors.gray,
      pink: colors.pink,
    },
    extend: {
      typography: {
        DEFAULT: {
          css: {
            a: {
              color: colors.pink['700'],
            },
            h2: {
              paddingBottom: spacing['2'],
              borderBottomWidth: '1px',
              borderColor: colors.gray['300'],
            },
            pre: {
              marginLeft: `-${spacing['4']}`,
              marginRight: `-${spacing['4']}`,
              backgroundColor: colors.gray['100'],
            },
            'pre code': {
              fontSize: '0.875rem',
              color: colors.gray['700'],
            },
            'pre code::before': {
              display: 'none',
            },
            'pre code::after': {
              display: 'none',
            },
            code: {
              fontWeight: fontWeight['normal'],
              backgroundColor: colors.gray['100'],
              paddingTop: spacing['1'],
              paddingBottom: spacing['1'],
              paddingLeft: spacing['1'],
              paddingRight: spacing['1'],
              borderRadius: borderRadius.md,
            },
            'code::before': {
              content: null,
            },
            'code::after': {
              content: null,
            },
            'a code': {
              color: colors.pink['700'],
            },
            ul: noMargin,
            'ul ul, ul ol, ol ul, ol ol': noMargin,
            li: noMargin,
            '> ol > li > *:last-child': noMargin,
            '> ul > li > *:last-child': noMargin,
          },
        },
        xl: {
          css: {
            pre: {
              marginLeft: `-${spacing['6']}`,
              marginRight: `-${spacing['6']}`,
              marginTop:    spacing['4'],
              marginBottom: spacing['4'],
            },
            'pre code': {
              fontSize: '1rem',
            },
            code: {
              fontSize: '1rem',
            },
            ul: noMargin,
            'ul ul, ul ol, ol ul, ol ol': noMargin,
            li: noMargin,
            '> ol > li > *:last-child': noMargin,
            '> ul > li > *:last-child': noMargin,
          }
        }
      }
    },
  },
  variants: {
    extend: {
      textColor: ['dark', 'hover', 'focus'],
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
  corePlugins: {
    translate: false,
    gap: false,
    ringColor: false,
    ringWidth: false,
    ringOpacity: false,
    ringOffsetWidth: false,
    ringOffsetColor: false,
    gradientColorStops: false,
    placeholderColor: false,
    inset: false,
  }
}
