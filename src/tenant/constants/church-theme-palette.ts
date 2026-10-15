import { ChurchThemePreset } from '../enum/church-theme-preset.enum';

// Must match THEME_PRESETS in discuva-admin and discuva-member utils/portal-theme.ts.
const PALETTE: Record<ChurchThemePreset, { brand: string; accent: string }> = {
  [ChurchThemePreset.CLASSIC]: { brand: '#121212', accent: '#EADCC9' },
  [ChurchThemePreset.OCEAN]: { brand: '#084C61', accent: '#8DD5D5' },
  [ChurchThemePreset.FOREST]: { brand: '#24583F', accent: '#A8CAA7' },
  [ChurchThemePreset.SUNSET]: { brand: '#9C3D2E', accent: '#EFA071' },
  [ChurchThemePreset.SKY]: { brand: '#1F5E91', accent: '#8EC6EB' },
  [ChurchThemePreset.PLUM]: { brand: '#624376', accent: '#C3A6E4' },
  [ChurchThemePreset.MARIGOLD]: { brand: '#875500', accent: '#F1BE58' },
  [ChurchThemePreset.ROSE]: { brand: '#9C3F64', accent: '#ECB1C7' },
  [ChurchThemePreset.TEAL]: { brand: '#0F766E', accent: '#99F6E4' },
  [ChurchThemePreset.CRIMSON]: { brand: '#9F1239', accent: '#FDA4AF' },
  [ChurchThemePreset.INDIGO]: { brand: '#3730A3', accent: '#C7D2FE' },
  [ChurchThemePreset.OLIVE]: { brand: '#4D5C1C', accent: '#D9E5A0' },
};

export interface ChurchThemeColors {
  // Dark: header bands and rules, with white or accent text on top.
  brand: string;
  // Light: table headers and highlights, with dark text on top.
  accent: string;
  // Accent halfway to white: alternate table rows.
  soft: string;
  // Accent 80% of the way to white: email highlight boxes, which need to stay light on every theme.
  tint: string;
}

function towardWhite(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) =>
    Math.floor(c + (255 - c) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`.toUpperCase();
}

export function churchThemeColors(
  preset: string | null | undefined,
): ChurchThemeColors {
  const { brand, accent } =
    PALETTE[preset as ChurchThemePreset] ?? PALETTE[ChurchThemePreset.CLASSIC];
  return {
    brand,
    accent,
    soft: towardWhite(accent, 0.5),
    tint: towardWhite(accent, 0.8),
  };
}
