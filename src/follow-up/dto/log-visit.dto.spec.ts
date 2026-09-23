import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LogVisitDto } from './log-visit.dto';

describe('LogVisitDto', () => {
  it('accepts an empty-string eventId as if it were absent', async () => {
    const dto = plainToInstance(LogVisitDto, { eventId: '' });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toHaveLength(0);
    expect(dto.eventId).toBeUndefined();
  });

  it('rejects a non-UUID eventId', async () => {
    const dto = plainToInstance(LogVisitDto, { eventId: 'not-a-uuid' });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.some((e) => e.property === 'eventId')).toBe(true);
  });
});
