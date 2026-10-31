import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RotaAllocationService } from './rota-allocation.service';
import { RotaAllocationMode } from '../enum/rota-allocation-mode.enum';

describe('RotaAllocationService', () => {
  const assignments = { query: jest.fn() };
  const unavailability = {
    find: jest.fn(),
    query: jest.fn(),
    delete: jest.fn(),
  };
  const timezone = { get: jest.fn().mockResolvedValue('Africa/Lagos') };
  const service = new RotaAllocationService(
    assignments as never,
    unavailability as never,
    timezone as never,
  );
  const future = new Date('2030-06-09T09:00:00Z');

  beforeEach(() => jest.clearAllMocks());

  it('requires a lead or delegated planner', async () => {
    assignments.query.mockResolvedValueOnce([
      { is_leader: false, subteam_ids: [], all_scope: false },
    ]);
    await expect(
      service.generate(
        'member',
        'department',
        'slot',
        [],
        new Date('2030-01-01'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps locked people, fills fixed and automatic duties, and explains gaps', async () => {
    assignments.query
      .mockResolvedValueOnce([
        { is_leader: true, subteam_ids: [], all_scope: false },
      ])
      .mockResolvedValueOnce([
        {
          id: 'slot',
          start_time: future,
          end_time: new Date('2030-06-09T11:00:00Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          responsibility_id: 'lead',
          responsibility_name: 'Lead vocalist',
          required_count: 1,
          allocation_mode: RotaAllocationMode.FIXED,
          subteam_id: 'vocals',
          member_id: 'fixed',
          is_fixed: true,
          leave: null,
          unavailable: false,
          conflict: null,
          workload: 3,
          last_served: null,
        },
        {
          responsibility_id: 'backup',
          responsibility_name: 'Backup vocalist',
          required_count: 2,
          allocation_mode: RotaAllocationMode.AUTOMATIC,
          subteam_id: 'vocals',
          member_id: 'away',
          is_fixed: false,
          leave: 'APPROVED',
          unavailable: false,
          conflict: null,
          workload: 0,
          last_served: null,
        },
        {
          responsibility_id: 'backup',
          responsibility_name: 'Backup vocalist',
          required_count: 2,
          allocation_mode: RotaAllocationMode.AUTOMATIC,
          subteam_id: 'vocals',
          member_id: 'available',
          is_fixed: false,
          leave: null,
          unavailable: false,
          conflict: null,
          workload: 1,
          last_served: null,
        },
        {
          responsibility_id: 'door',
          responsibility_name: 'Main door',
          required_count: 1,
          allocation_mode: RotaAllocationMode.MANUAL,
          subteam_id: null,
          member_id: null,
          is_fixed: null,
          leave: null,
          unavailable: null,
          conflict: null,
          workload: null,
          last_served: null,
        },
      ]);

    const result = await service.generate(
      'leader',
      'department',
      'slot',
      [{ memberId: 'locked', role: 'Backup vocalist' }],
      new Date('2030-01-01'),
    );

    expect(result.entries).toEqual([
      { memberId: 'locked', role: 'Backup vocalist', locked: true },
      { memberId: 'fixed', role: 'Lead vocalist', locked: false },
      { memberId: 'available', role: 'Backup vocalist', locked: false },
    ]);
    expect(result.gaps).toEqual([
      {
        responsibilityId: 'door',
        responsibility: 'Main door',
        count: 1,
        reason: 'Choose manually',
      },
    ]);
  });

  it('does not allow a past unavailable date', async () => {
    await expect(
      service.saveUnavailable(
        'member',
        { date: '2029-12-31' },
        new Date('2030-01-01T10:00:00Z'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
