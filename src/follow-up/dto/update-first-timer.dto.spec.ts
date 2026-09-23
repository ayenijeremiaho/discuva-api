import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateFirstTimerDto } from './update-first-timer.dto';

describe('UpdateFirstTimerDto', () => {
  it('accepts a partial update with a single field', async () => {
    const dto = plainToInstance(UpdateFirstTimerDto, {
      visitedEventId: '5b3e7f2a-1c4d-4a9e-8b3f-2d6c9a0e1f7b',
    });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toHaveLength(0);
  });

  it('accepts an empty-string visitedEventId as if it were absent', async () => {
    const dto = plainToInstance(UpdateFirstTimerDto, { visitedEventId: '' });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toHaveLength(0);
    expect(dto.visitedEventId).toBeUndefined();
  });

  it('rejects a non-UUID visitedEventId', async () => {
    const dto = plainToInstance(UpdateFirstTimerDto, {
      visitedEventId: 'not-a-uuid',
    });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.some((e) => e.property === 'visitedEventId')).toBe(true);
  });

  it('rejects an invalid email', async () => {
    const dto = plainToInstance(UpdateFirstTimerDto, {
      email: 'not-an-email',
    });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});
