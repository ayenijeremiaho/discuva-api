import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import * as ExcelJS from 'exceljs';
import { CacheService } from './cache.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import {
  ChurchThemeColors,
  churchThemeColors,
} from '../../tenant/constants/church-theme-palette';

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
}

const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;

@Injectable()
export class ExcelService {
  private readonly cacheTtl: number;

  constructor(
    config: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly cacheService: CacheService,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
  ) {
    this.cacheTtl = config.get<number>('CACHE_TTL_REFERENCE_SECONDS', 300);
  }

  // The church's theme; Classic outside a tenant request. Shares PdfService's tenant-branding cache entry.
  async themeColors(): Promise<ChurchThemeColors> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return churchThemeColors(null);
    const tenant = await this.cacheService.getOrSet(
      `tenant-branding:${tenantId}`,
      () => this.tenantRepository.findOneBy({ id: tenantId }),
      this.cacheTtl,
    );
    return churchThemeColors(tenant?.themePreset);
  }

  // Header row in the church's accent with a rule in its main colour, kept in view while scrolling.
  styleHeaderRow(sheet: ExcelJS.Worksheet, theme: ChurchThemeColors): void {
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FF121212' } };
    header.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: argb(theme.accent) },
      };
      cell.border = {
        bottom: { style: 'medium', color: { argb: argb(theme.brand) } },
      };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  async buildWorkbook(
    sheetTitle: string,
    columns: ExcelColumn[],
    rows: Record<string, any>[],
  ): Promise<Buffer> {
    const theme = await this.themeColors();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetTitle);
    sheet.columns = columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? 20,
    }));
    this.styleHeaderRow(sheet, theme);

    for (const row of rows) {
      sheet.addRow(row);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
