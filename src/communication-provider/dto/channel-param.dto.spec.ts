import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ChannelAndProviderParamDto,
  ChannelParamDto,
} from './channel-param.dto';

// Regression coverage for a real bug: main.ts's global ValidationPipe runs
// with whitelist + forbidNonWhitelisted, and PATCH :channel/:providerId
// binds its *whole* params object (both keys) through a single @Param()
// decorator — a DTO that only declares one of the two present keys gets
// the other rejected as "should not exist" on every real HTTP call, even
// though a unit test calling controller.setActive(...) directly never
// exercises the pipe and can't catch this.
describe('ChannelAndProviderParamDto', () => {
  it('accepts both channel and providerId together', async () => {
    const dto = plainToInstance(ChannelAndProviderParamDto, {
      channel: 'email',
      providerId: 'sendgrid',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid channel', async () => {
    const dto = plainToInstance(ChannelAndProviderParamDto, {
      channel: 'fax',
      providerId: 'sendgrid',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('ChannelParamDto', () => {
  it('accepts channel alone (single-param route)', async () => {
    const dto = plainToInstance(ChannelParamDto, { channel: 'sms' });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  // Documents the exact defect this file exists to prevent regressing to:
  // binding a two-param route's whole @Param() object through this DTO
  // rejects the extra key under whitelist+forbidNonWhitelisted.
  it('rejects an extra providerId key — why setActive cannot use this DTO', async () => {
    const dto = plainToInstance(ChannelParamDto, {
      channel: 'email',
      providerId: 'sendgrid',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
