// FixAm design tokens. High contrast, big type and big touch targets for low-end phones in bright sun.
export const colors = {
  brand: '#0B7A3E', // Salone green
  brandDark: '#075C2E',
  brandSoft: '#E3F3E9',
  accent: '#F2A900', // "save money" amber
  accentSoft: '#FFF4D6',
  info: '#0A5FB4',
  infoSoft: '#E4EFFB',
  danger: '#C62828',
  dangerSoft: '#FDE7E7',
  warn: '#B25E00',
  warnSoft: '#FFF0DC',
  success: '#1B7F3B',
  successSoft: '#E2F4E7',
  text: '#111418',
  textMuted: '#4A525C',
  border: '#D5DAD3',
  bg: '#F4F6F3',
  card: '#FFFFFF',
  white: '#FFFFFF',
  disabled: '#9AA39C',
  pro: '#123C69', // FixAm Pro navy, so the two apps are easy to tell apart
  proSoft: '#E3ECF6',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const font = {
  small: 15,
  body: 17,
  large: 20,
  title: 24,
  hero: 30,
  code: 56,
};

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

/** Minimum touch target (Android guidance is 48 dp; we go bigger for gloved/oily fingers on site). */
export const TOUCH = 56;

export type Tone = 'brand' | 'info' | 'warn' | 'danger' | 'success' | 'neutral' | 'accent';

export function toneColors(tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case 'brand':
      return { fg: colors.brandDark, bg: colors.brandSoft };
    case 'info':
      return { fg: colors.info, bg: colors.infoSoft };
    case 'warn':
      return { fg: colors.warn, bg: colors.warnSoft };
    case 'danger':
      return { fg: colors.danger, bg: colors.dangerSoft };
    case 'success':
      return { fg: colors.success, bg: colors.successSoft };
    case 'accent':
      return { fg: '#7A5400', bg: colors.accentSoft };
    default:
      return { fg: colors.textMuted, bg: '#ECEFEA' };
  }
}
