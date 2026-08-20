import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateEmailCategorySettingDto } from './email-category-setting.dto';

describe('UpdateEmailCategorySettingDto', () => {
  it('accepts enabled: true', async () => {
    const dto = plainToInstance(UpdateEmailCategorySettingDto, {
      enabled: true,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts enabled: false — @IsNotEmpty does not reject false', async () => {
    const dto = plainToInstance(UpdateEmailCategorySettingDto, {
      enabled: false,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing enabled flag', async () => {
    const dto = plainToInstance(UpdateEmailCategorySettingDto, {});
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-boolean enabled value', async () => {
    const dto = plainToInstance(UpdateEmailCategorySettingDto, {
      enabled: 'yes',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
