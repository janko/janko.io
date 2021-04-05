const colors = require('tailwindcss/colors')
const { spacing, fontWeight, borderRadius } = require('tailwindcss/defaultTheme')

const noMargin = { marginTop: 0, marginBottom: 0 }

module.exports = {
  mode: 'jit',
  purge: [
    'pages/**/*.html',
    '_layouts/**/*.html',
    '_includes/**/*.html',
  ],
  darkMode: false,
  theme: {
    extend: {
      colors: {
        gray: {
          '450': '#94949e',
        },
        teal: colors.teal,
      },
      fontSize: {
        '5xl': ['3rem', 1.125],
        '2xs': '0.7rem',
      },
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
              paddingLeft: spacing['4'],
              paddingRight: spacing['4'],
              backgroundColor: colors.gray['100'],
            },
            'pre code': {
              fontSize: spacing['3.5'],
              color: colors.gray['700'],
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
              lineHeight: '1.55',
            },
            'pre code': {
              fontSize: spacing['4'],
            },
            code: {
              fontSize: spacing['4'],
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
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
