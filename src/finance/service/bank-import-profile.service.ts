import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BankImportProfile } from '../entity/bank-import-profile.entity';
import {
  CreateBankImportProfileDto,
  UpdateBankImportProfileDto,
} from '../dto/bank-import-profile.dto';
import { Admin } from '../../admin/entity/admin.entity';
import { CsvParser } from '../util/csv-parser';
import { AmountConvention } from '../enum/finance.enum';

@Injectable()
export class BankImportProfileService {
  constructor(
    @InjectRepository(BankImportProfile)
    private readonly profileRepo: Repository<BankImportProfile>,
  ) {}

  async create(
    dto: CreateBankImportProfileDto,
    admin: Admin,
  ): Promise<BankImportProfile> {
    this.validateConvention(dto.amountConvention, dto);
    if (dto.isDefault) {
      await this.profileRepo.update({ isDefault: true }, { isDefault: false });
    }
    const profile = this.profileRepo.create({
      name: dto.name,
      isDefault: dto.isDefault ?? false,
      delimiter: dto.delimiter,
      skipHeaderRows: dto.skipHeaderRows,
      dateColumnIndex: dto.dateColumnIndex,
      dateFormat: dto.dateFormat,
      dateColumnName: dto.dateColumnName ?? null,
      narrationColumnIndex: dto.narrationColumnIndex,
      narrationColumnName: dto.narrationColumnName ?? null,
      amountConvention: dto.amountConvention,
      amountColumnIndex: dto.amountColumnIndex ?? null,
      amountColumnName: dto.amountColumnName ?? null,
      typeColumnIndex: dto.typeColumnIndex ?? null,
      typeColumnName: dto.typeColumnName ?? null,
      debitIndicator: dto.debitIndicator ?? null,
      creditIndicator: dto.creditIndicator ?? null,
      debitColumnIndex: dto.debitColumnIndex ?? null,
      debitColumnName: dto.debitColumnName ?? null,
      creditColumnIndex: dto.creditColumnIndex ?? null,
      creditColumnName: dto.creditColumnName ?? null,
      createdBy: { id: admin.id } as any,
    });
    return this.profileRepo.save(profile);
  }

  findAll(): Promise<BankImportProfile[]> {
    return this.profileRepo.find({
      relations: ['createdBy'],
      order: { isDefault: 'DESC', name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<BankImportProfile> {
    const profile = await this.profileRepo.findOne({
      where: { id },
      relations: ['createdBy'],
    });
    if (!profile) throw new NotFoundException('Bank import profile not found.');
    return profile;
  }

  findDefault(): Promise<BankImportProfile | null> {
    return this.profileRepo.findOne({ where: { isDefault: true } });
  }

  async update(
    id: string,
    dto: UpdateBankImportProfileDto,
    _admin: Admin,
  ): Promise<BankImportProfile> {
    const profile = await this.findOne(id);
    if (dto.amountConvention)
      this.validateConvention(dto.amountConvention, dto);
    if (dto.isDefault) {
      await this.profileRepo.update({ isDefault: true }, { isDefault: false });
    }
    Object.assign(profile, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
      ...(dto.delimiter !== undefined && { delimiter: dto.delimiter }),
      ...(dto.skipHeaderRows !== undefined && {
        skipHeaderRows: dto.skipHeaderRows,
      }),
      ...(dto.dateColumnIndex !== undefined && {
        dateColumnIndex: dto.dateColumnIndex,
      }),
      ...(dto.dateFormat !== undefined && { dateFormat: dto.dateFormat }),
      ...(dto.dateColumnName !== undefined && {
        dateColumnName: dto.dateColumnName,
      }),
      ...(dto.narrationColumnIndex !== undefined && {
        narrationColumnIndex: dto.narrationColumnIndex,
      }),
      ...(dto.narrationColumnName !== undefined && {
        narrationColumnName: dto.narrationColumnName,
      }),
      ...(dto.amountConvention !== undefined && {
        amountConvention: dto.amountConvention,
      }),
      ...(dto.amountColumnIndex !== undefined && {
        amountColumnIndex: dto.amountColumnIndex,
      }),
      ...(dto.amountColumnName !== undefined && {
        amountColumnName: dto.amountColumnName,
      }),
      ...(dto.typeColumnIndex !== undefined && {
        typeColumnIndex: dto.typeColumnIndex,
      }),
      ...(dto.typeColumnName !== undefined && {
        typeColumnName: dto.typeColumnName,
      }),
      ...(dto.debitIndicator !== undefined && {
        debitIndicator: dto.debitIndicator,
      }),
      ...(dto.creditIndicator !== undefined && {
        creditIndicator: dto.creditIndicator,
      }),
      ...(dto.debitColumnIndex !== undefined && {
        debitColumnIndex: dto.debitColumnIndex,
      }),
      ...(dto.debitColumnName !== undefined && {
        debitColumnName: dto.debitColumnName,
      }),
      ...(dto.creditColumnIndex !== undefined && {
        creditColumnIndex: dto.creditColumnIndex,
      }),
      ...(dto.creditColumnName !== undefined && {
        creditColumnName: dto.creditColumnName,
      }),
    });
    return this.profileRepo.save(profile);
  }

  async downloadTemplate(
    id: string,
  ): Promise<{ filename: string; content: Buffer }> {
    const profile = await this.findOne(id);
    const headers = CsvParser.buildTemplateHeaders(profile);

    const sampleRows = this.buildSampleRows(profile, headers.length);
    const lines = [
      headers.join(profile.delimiter),
      ...sampleRows.map((r) => r.join(profile.delimiter)),
    ];
    return {
      filename: `${profile.name.replace(/\s+/g, '_').toLowerCase()}_template.csv`,
      content: Buffer.from(lines.join('\n'), 'utf8'),
    };
  }

  private buildSampleRows(
    profile: BankImportProfile,
    colCount: number,
  ): string[][] {
    const empty = () => new Array<string>(colCount).fill('');
    const sample1 = empty();
    const sample2 = empty();
    sample1[profile.dateColumnIndex] = CsvParser.formatSampleDate(
      profile.dateFormat,
      1,
    );
    sample2[profile.dateColumnIndex] = CsvParser.formatSampleDate(
      profile.dateFormat,
      2,
    );
    sample1[profile.narrationColumnIndex] = 'Sample income transaction';
    sample2[profile.narrationColumnIndex] = 'Sample expense payment';

    switch (profile.amountConvention) {
      case AmountConvention.SIGNED:
        sample1[profile.amountColumnIndex!] = '50000';
        sample2[profile.amountColumnIndex!] = '-15000';
        break;
      case AmountConvention.SEPARATE_COLUMNS:
        sample1[profile.creditColumnIndex!] = '50000';
        sample2[profile.debitColumnIndex!] = '15000';
        break;
      case AmountConvention.AMOUNT_WITH_TYPE:
        sample1[profile.amountColumnIndex!] = '50000';
        sample1[profile.typeColumnIndex!] = profile.creditIndicator ?? 'CREDIT';
        sample2[profile.amountColumnIndex!] = '15000';
        sample2[profile.typeColumnIndex!] = profile.debitIndicator ?? 'DEBIT';
        break;
    }
    return [sample1, sample2];
  }

  private validateConvention(
    convention: AmountConvention,
    dto: Partial<CreateBankImportProfileDto>,
  ): void {
    switch (convention) {
      case AmountConvention.SIGNED:
        if (
          dto.amountColumnIndex === undefined ||
          dto.amountColumnIndex === null
        ) {
          throw new BadRequestException(
            'amountColumnIndex is required for SIGNED convention.',
          );
        }
        break;
      case AmountConvention.SEPARATE_COLUMNS:
        if (
          dto.debitColumnIndex === undefined ||
          dto.creditColumnIndex === undefined
        ) {
          throw new BadRequestException(
            'debitColumnIndex and creditColumnIndex are required for SEPARATE_COLUMNS convention.',
          );
        }
        break;
      case AmountConvention.AMOUNT_WITH_TYPE:
        if (
          dto.amountColumnIndex === undefined ||
          dto.typeColumnIndex === undefined
        ) {
          throw new BadRequestException(
            'amountColumnIndex and typeColumnIndex are required for AMOUNT_WITH_TYPE convention.',
          );
        }
        break;
    }
  }
}
