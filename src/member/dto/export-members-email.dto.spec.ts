import { UpdateExportSettingsDto } from './update-export-settings.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  ExportMembersEmailDto,
  ExportWorkersEmailDto,
} from './export-members-email.dto';

describe('email export validation', () => {
  it('requires a valid explicit field array when saving defaults', async () => {
    for (const fields of [
      undefined,
      null,
      ['password'],
      ['address', 'address'],
    ]) {
      expect(
        (
          await validate(plainToInstance(UpdateExportSettingsDto, { fields }))
        ).map((e) => e.property),
      ).toContain('fields');
    }
    expect(
      await validate(plainToInstance(UpdateExportSettingsDto, { fields: [] })),
    ).toHaveLength(0);
  });

  it('accepts supported optional fields and rejects unknown, duplicate and non-array fields', async () => {
    for (const fields of [[], ['emergencyContactName', 'profession']]) {
      expect(
        await validate(plainToInstance(ExportMembersEmailDto, { fields })),
      ).toHaveLength(0);
    }
    for (const fields of [['password'], ['address', 'address'], 'address']) {
      expect(
        (
          await validate(plainToInstance(ExportMembersEmailDto, { fields }))
        ).map((e) => e.property),
      ).toContain('fields');
    }
  });

  it('accepts a blank payload for the requesting admin', async () => {
    expect(await validate(new ExportMembersEmailDto())).toHaveLength(0);
  });
  it('validates email, status and boolean filters', async () => {
    const dto = plainToInstance(ExportMembersEmailDto, {
      recipientEmail: 'bad',
      status: 'UNKNOWN',
      wantsToServe: 'true',
    });
    expect((await validate(dto)).map((e) => e.property)).toEqual(
      expect.arrayContaining(['recipientEmail', 'status', 'wantsToServe']),
    );
  });
  it('requires a valid department UUID and accepts false trainee filter', async () => {
    const dto = plainToInstance(ExportWorkersEmailDto, {
      departmentId: 'bad',
      isTrainee: false,
    });
    expect((await validate(dto)).map((e) => e.property)).toEqual([
      'departmentId',
    ]);
  });
});
