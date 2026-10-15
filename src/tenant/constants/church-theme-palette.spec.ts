import { churchThemeColors } from './church-theme-palette';
import { ChurchThemePreset } from '../enum/church-theme-preset.enum';

describe('churchThemeColors', () => {
  it('has colours for every preset, with a lighter shade for table rows', () => {
    for (const preset of Object.values(ChurchThemePreset)) {
      const { brand, accent, soft, tint } = churchThemeColors(preset);
      for (const hex of [brand, accent, soft, tint]) {
        expect(hex).toMatch(/^#[0-9A-F]{6}$/);
      }
      expect(soft).not.toBe(accent);
    }
  });

  it('reproduces the original Classic black and gold exactly', () => {
    expect(churchThemeColors(ChurchThemePreset.CLASSIC)).toEqual({
      brand: '#121212',
      accent: '#EADCC9',
      soft: '#F4EDE4',
      tint: '#FAF8F4',
    });
  });
});
