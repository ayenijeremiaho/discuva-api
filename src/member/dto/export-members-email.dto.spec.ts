import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  ExportMembersEmailDto,
  ExportWorkersEmailDto,
} from './export-members-email.dto';

describe('email export validation', () => {
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
