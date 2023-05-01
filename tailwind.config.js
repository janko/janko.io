const colors = require('tailwindcss/colors')
const { spacing, fontWeight, borderRadius } = require('tailwindcss/defaultTheme')

const noMargin = { marginTop: 0, marginBottom: 0 }

module.exports = {
  content: [
    'pages/**/*.html',
    '_layouts/**/*.html',
    '_includes/**/*.html',
  ],
  theme: {
    extend: {
      screens: {
        xs: '460px',
      },
      colors: {
        gray: {
          '450': '#94949e',
        }
      },
      fontSize: {
        '5xl': ['3rem', 1.125],
        '2xs': '0.7rem',
      },
      typography: {
        pink: {
          css: {
            '--tw-prose-links': colors.pink['700'],
          }
        },
        DEFAULT: {
          css: {
            '--tw-prose-pre-code': colors.gray[700],
            '--tw-prose-pre-bg': colors.gray[100],
            'pre code': {
              fontSize: spacing['3.5'],
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
            ul: noMargin,
            'ul ul, ul ol, ol ul, ol ol': noMargin,
            li: noMargin,
            '> ol > li > *:last-child': noMargin,
            '> ul > li > *:last-child': noMargin,
          },
        },
        xl: {
          css: {
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
        },
        invert: {
          css: {
            '--tw-prose-invert-pre-bg': colors.slate[800],
            code: {
              backgroundColor: 'var(--tw-prose-invert-pre-bg)',
              borderWidth: '1px',
              borderColor: colors.slate[700],
            },
            'pre code': {
              borderWidth: '0px',
            },
            pre: {
              borderWidth: '1px',
              borderColor: colors.slate[700],
            }
          }
        }
      }
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
