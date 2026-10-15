import { fetchLogoBytes, fitLogo, measureLogo } from './logo-size';

// 1x1 PNG with its header rewritten to the given size; image-size reads only the header.
function pngOf(width: number, height: number): Buffer {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

describe('fitLogo', () => {
  it('fits the recommended square logo to the tile height', () => {
    expect(fitLogo({ width: 512, height: 512 })).toEqual({
      width: 64,
      height: 64,
    });
  });

  it('keeps a very wide logo in proportion instead of squeezing it', () => {
    expect(fitLogo({ width: 600, height: 100 })).toEqual({
      width: 200,
      height: 33,
    });
  });

  it('keeps a tall logo in proportion', () => {
    expect(fitLogo({ width: 300, height: 600 })).toEqual({
      width: 32,
      height: 64,
    });
  });
});

describe('measureLogo', () => {
  it('reads the real size of a PNG', () => {
    expect(measureLogo(pngOf(512, 512))).toEqual({ width: 512, height: 512 });
  });

  it('reads an SVG', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="520" height="260"></svg>',
    );
    expect(measureLogo(svg)).toEqual({ width: 520, height: 260 });
  });

  it('returns null for something that is not an image', () => {
    expect(measureLogo(Buffer.from('not an image'))).toBeNull();
  });
});

describe('fetchLogoBytes', () => {
  it('decodes a data URL without a network call', async () => {
    const bytes = await fetchLogoBytes(
      `data:image/png;base64,${pngOf(10, 20).toString('base64')}`,
    );
    expect(measureLogo(bytes!)).toEqual({ width: 10, height: 20 });
  });

  it('returns null when the logo cannot be downloaded', async () => {
    const spy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false } as Response);
    await expect(
      fetchLogoBytes('https://example.com/missing.png'),
    ).resolves.toBeNull();
    spy.mockRestore();
  });
});
