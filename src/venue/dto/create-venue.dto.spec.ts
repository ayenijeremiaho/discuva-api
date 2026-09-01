import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateVenueDto } from './create-venue.dto';

describe('UpdateVenueDto', () => {
  it('allows omitting latitude and longitude entirely', async () => {
    const dto = plainToInstance(UpdateVenueDto, { name: 'Renamed Hall' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects latitude provided without longitude', async () => {
    const dto = plainToInstance(UpdateVenueDto, { latitude: 6.5244 });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'longitude')).toBe(true);
  });

  it('rejects longitude provided without latitude', async () => {
    const dto = plainToInstance(UpdateVenueDto, { longitude: 3.3792 });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'latitude')).toBe(true);
  });

  it('accepts latitude and longitude provided together', async () => {
    const dto = plainToInstance(UpdateVenueDto, {
      latitude: 6.5244,
      longitude: 3.3792,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects an out-of-range pair', async () => {
    const dto = plainToInstance(UpdateVenueDto, {
      latitude: 200,
      longitude: 400,
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'latitude')).toBe(true);
    expect(errors.some((e) => e.property === 'longitude')).toBe(true);
  });
});
