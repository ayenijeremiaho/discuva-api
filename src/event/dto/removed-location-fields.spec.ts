import { BadRequestException } from '@nestjs/common';
import { TrimValidationPipe } from '../../utility/pipes/trim-validation.pipe';
import { CreateEventConfigDto } from './create-event-config.dto';
import { UpdateEventConfigDto } from './update-event-config.dto';
import { CreateServiceSlotDto } from './create-service-slot.dto';

// The same validation the app runs on every request (main.ts).
const pipe = new TrimValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const validate = (metatype: unknown, value: object) =>
  pipe.transform(value, { type: 'body', metatype: metatype as never });

const config = {
  name: 'Home Fellowship',
  description: 'Midweek house groups',
  defaultVenueId: 'b3f1c1f4-1d5e-4a8c-9a32-6a2f0e3d9c11',
  workerCheckinStartOffsetSeconds: -7200,
  workerLateOffsetSeconds: 0,
  memberCheckinStartOffsetSeconds: -3600,
  checkinStopOffsetSeconds: 7200,
  allowedDistanceInMeters: 100,
};

// "Enforce Member Check-In Location" was replaced by checkDistance and its columns dropped; keep it gone.
describe('removed member-location fields', () => {
  it('accepts a config with the current checkDistance setting', async () => {
    await expect(
      validate(CreateEventConfigDto, { ...config, checkDistance: false }),
    ).resolves.toMatchObject({ checkDistance: false });
  });

  it('rejects the old enforceMemberLocation on create and update', async () => {
    await expect(
      validate(CreateEventConfigDto, {
        ...config,
        enforceMemberLocation: true,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      validate(UpdateEventConfigDto, { enforceMemberLocation: true }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects the old per-slot enforceMemberLocationOverride', async () => {
    await expect(
      validate(CreateServiceSlotDto, {
        startTime: '2026-10-18T08:00:00.000Z',
        endTime: '2026-10-18T10:00:00.000Z',
        enforceMemberLocationOverride: true,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
