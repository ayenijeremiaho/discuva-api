import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFirstTimerDto } from './create-first-timer.dto';

const base = { firstname: 'Ada', lastname: 'Obi', phone: '08011112222' };

describe('CreateFirstTimerDto', () => {
  it('accepts a missing visitedEventId', async () => {
    const dto = plainToInstance(CreateFirstTimerDto, { ...base });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toHaveLength(0);
  });

  it('accepts an empty-string visitedEventId as if it were absent', async () => {
    const dto = plainToInstance(CreateFirstTimerDto, {
      ...base,
      visitedEventId: '',
    });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toHaveLength(0);
    expect(dto.visitedEventId).toBeUndefined();
  });

  it('rejects a non-UUID visitedEventId', async () => {
    const dto = plainToInstance(CreateFirstTimerDto, {
      ...base,
      visitedEventId: 'not-a-uuid',
    });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.some((e) => e.property === 'visitedEventId')).toBe(true);
  });

  it('accepts a valid UUID visitedEventId', async () => {
    const dto = plainToInstance(CreateFirstTimerDto, {
      ...base,
      visitedEventId: '5b3e7f2a-1c4d-4a9e-8b3f-2d6c9a0e1f7b',
    });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toHaveLength(0);
  });
});
