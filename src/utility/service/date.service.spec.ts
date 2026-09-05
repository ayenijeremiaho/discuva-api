import { ConfigService } from '@nestjs/config';
import { DateService } from './date.service';

const mockConfigService = {
  get: jest.fn().mockReturnValue('Africa/Lagos'),
};

describe('DateService', () => {
  let service: DateService;

  beforeEach(() => {
    service = new DateService(mockConfigService as unknown as ConfigService);
  });

  describe('startOfDay', () => {
    it('uses the configured timezone, not the server process timezone', () => {
      // 23:30 UTC on the 16th is already 00:30 on the 17th in Africa/Lagos (UTC+1) —
      // a UTC-local implementation would wrongly anchor to the 16th.
      const instant = new Date('2026-07-16T23:30:00.000Z');
      const result = service.startOfDay(instant);
      expect(result.toISOString()).toBe('2026-07-16T23:00:00.000Z');
    });
  });

  describe('endOfDay', () => {
    it('uses the configured timezone, not the server process timezone', () => {
      const instant = new Date('2026-07-16T23:30:00.000Z');
      const result = service.endOfDay(instant);
      expect(result.toISOString()).toBe('2026-07-17T22:59:59.999Z');
    });
  });

  describe('today', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns the church-timezone date, not the day it still is in UTC', () => {
      // 23:30 UTC on the 16th is already the 17th in Africa/Lagos (UTC+1) —
      // a plain format(new Date(), ...) would wrongly return the 16th.
      jest.useFakeTimers().setSystemTime(new Date('2026-07-16T23:30:00.000Z'));
      expect(service.today()).toBe('2026-07-17');
    });

    it('returns the same-day date when well within the church-timezone day', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-16T10:00:00.000Z'));
      expect(service.today()).toBe('2026-07-16');
    });
  });
});
