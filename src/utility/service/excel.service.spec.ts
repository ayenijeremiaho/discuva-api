import * as ExcelJS from 'exceljs';
import { ExcelService } from './excel.service';

describe('ExcelService', () => {
  const config = { get: (_k: string, d: unknown) => d };

  function make(tenantId: string | undefined, themePreset?: string) {
    const cache = {
      getOrSet: jest.fn(async (_k: string, load: () => unknown) => load()),
    };
    const repo = {
      findOneBy: jest.fn().mockResolvedValue({ id: tenantId, themePreset }),
    };
    const service = new ExcelService(
      config as any,
      { get: () => tenantId } as any,
      cache as any,
      repo as any,
    );
    return { service, cache, repo };
  }

  async function headerOf(buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);
    const ws = wb.worksheets[0];
    return { cell: ws.getRow(1).getCell(1), views: ws.views };
  }

  it("styles the header row in the church's theme and keeps it in view", async () => {
    const { service, cache } = make('t1', 'ocean');
    const { cell, views } = await headerOf(
      await service.buildWorkbook(
        'Report',
        [{ header: 'Name', key: 'n' }],
        [{ n: 'Ada' }],
      ),
    );

    expect((cell.fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF8DD5D5');
    expect(cell.border?.bottom?.color?.argb).toBe('FF084C61');
    expect(cell.font?.bold).toBe(true);
    expect(views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(cache.getOrSet).toHaveBeenCalledWith(
      'tenant-branding:t1',
      expect.any(Function),
      300,
    );
  });

  it('keeps the original Classic gold for Classic churches, unknown presets and no church', async () => {
    for (const [tenantId, preset] of [
      ['t1', 'classic'],
      ['t1', 'not-a-preset'],
      [undefined, undefined],
    ] as const) {
      const { service } = make(tenantId, preset);
      expect(await service.themeColors()).toEqual({
        brand: '#121212',
        accent: '#EADCC9',
        soft: '#F4EDE4',
      });
    }
  });
});
