import {
  blueprintToSlotDtos,
  slotDtosToBlueprint,
  SlotBlueprint,
} from './slot-blueprint';

const sunday: SlotBlueprint[] = [
  {
    name: 'First Service',
    startTime: '08:00',
    durationMinutes: 120,
    dayOffset: 0,
    configId: 'cfg-1',
  },
  { name: 'Evening', startTime: '18:30', durationMinutes: 90, dayOffset: 1 },
];

describe('slot blueprint', () => {
  it('places times on the date in the church timezone', () => {
    const slots = blueprintToSlotDtos(sunday, '2026-10-04', 'Africa/Lagos');
    expect(slots[0]).toEqual(
      expect.objectContaining({
        name: 'First Service',
        configId: 'cfg-1',
        startTime: '2026-10-04T07:00:00.000Z',
        endTime: '2026-10-04T09:00:00.000Z',
      }),
    );
    expect(slots[1].startTime).toBe('2026-10-05T17:30:00.000Z');
  });

  it('keeps the wall-clock time across a DST change', () => {
    const before = blueprintToSlotDtos(sunday, '2026-03-22', 'Europe/London');
    const after = blueprintToSlotDtos(sunday, '2026-03-29', 'Europe/London');
    expect(before[0].startTime).toBe('2026-03-22T08:00:00.000Z');
    expect(after[0].startTime).toBe('2026-03-29T07:00:00.000Z');
  });

  it('turns absolute slots back into a blueprint', () => {
    const { date, blueprint } = slotDtosToBlueprint(
      blueprintToSlotDtos(sunday, '2026-10-04', 'Africa/Lagos'),
      'Africa/Lagos',
    );
    expect(date).toBe('2026-10-04');
    expect(blueprint).toEqual(sunday);
  });

  it('anchors on the local date even when the UTC date differs', () => {
    const { date, blueprint } = slotDtosToBlueprint(
      [
        {
          name: 'Vigil',
          startTime: '2026-10-03T23:30:00.000Z',
          endTime: '2026-10-04T03:00:00.000Z',
        },
      ],
      'Africa/Lagos',
    );
    expect(date).toBe('2026-10-04');
    expect(blueprint[0]).toEqual(
      expect.objectContaining({
        startTime: '00:30',
        durationMinutes: 210,
        dayOffset: 0,
      }),
    );
  });
});
