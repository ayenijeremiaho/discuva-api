import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateReminderSettingDto } from './reminder-setting.dto';

describe('UpdateReminderSettingDto', () => {
  it('accepts a valid enabled flag and threshold list', async () => {
    const dto = plainToInstance(UpdateReminderSettingDto, {
      enabled: true,
      thresholds: [7, 0, -3],
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts an empty threshold list', async () => {
    const dto = plainToInstance(UpdateReminderSettingDto, {
      enabled: false,
      thresholds: [],
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a threshold outside the -365..365 range', async () => {
    const dto = plainToInstance(UpdateReminderSettingDto, {
      enabled: true,
      thresholds: [400],
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-integer threshold', async () => {
    const dto = plainToInstance(UpdateReminderSettingDto, {
      enabled: true,
      thresholds: [7.5],
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects more than 10 thresholds', async () => {
    const dto = plainToInstance(UpdateReminderSettingDto, {
      enabled: true,
      thresholds: Array.from({ length: 11 }, (_, i) => i),
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a missing enabled flag', async () => {
    const dto = plainToInstance(UpdateReminderSettingDto, {
      thresholds: [7],
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
