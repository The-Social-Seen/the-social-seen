/**
 * Design Tokens — The Social Seen
 *
 * Programmatic access to brand colour values for use in JS contexts
 * (canvas, chart libraries, inline styles for animation particles, etc.)
 *
 * For Tailwind class usage, prefer the theme tokens defined in globals.css:
 *   bg-gold, text-text-primary, border-blush, bg-bg-primary, etc.
 */

export const colors = {
  /* Fixed brand colours — do not change with dark mode */
  charcoal: '#1C1C1E',
  cream: '#FAF7F2',
  white: '#FFFFFF',

  /* Gold family */
  gold: '#C9A96E',
  goldLight: '#D4B97F',
  goldDark: '#B8944F',

  /* Blush family */
  blush: '#E8D5C4',
  blushLight: '#F0E3D6',
  blushDark: '#D4BCA8',

  /* Border */
  border: '#E0D8CC',
  borderLight: '#EDE7DD',

  /* Status */
  success: '#4A7C59',
  danger: '#C45D4D',
  muted: '#6B6B6B',

  /* Dark mode surfaces (used in dark theme only) */
  darkBg: '#121214',
  darkSurface: '#1C1C1E',
  darkBorder: '#2C2C2E',
  darkText: '#F5F5F5',
  darkMuted: '#8E8E93',
} as const;

export const fonts = {
  serif: 'Playfair Display',
  sans: 'DM Sans',
} as const;

export const spacing = {
  maxWidth: '1280px',
  cardRadius: '12px',
  buttonRadiusPrimary: '9999px',
  buttonRadiusSecondary: '8px',
  sectionPaddingDesktop: '80px',
  sectionPaddingMobile: '48px',
  cardPadding: '24px',
  gridGap: '24px',
} as const;

/** Palette shorthand for confetti, charts, and other multi-colour uses */
export const brandPalette = [
  colors.gold,
  colors.blush,
  colors.goldDark,
  colors.charcoal,
  colors.cream,
] as const;

export type BrandColor = (typeof colors)[keyof typeof colors];
