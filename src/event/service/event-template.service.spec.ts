import { EventService } from './event.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventTemplateService } from './event-template.service';
import { EventTemplate } from '../entity/event-template.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';

const mockRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 't-1', ...v })),
  remove: jest.fn(),
};
const mockAudit = { log: jest.fn() };

const dto = {
  name: ' Midweek Bible Study ',
  slotBlueprint: [
    {
      name: 'Bible Study',
      startTime: '18:00',
      durationMinutes: 90,
      dayOffset: 0,
    },
  ],
};

describe('EventTemplateService', () => {
  let service: EventTemplateService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRepo.findOne.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventTemplateService,
        { provide: getRepositoryToken(EventTemplate), useValue: mockRepo },
        { provide: AuditLogService, useValue: mockAudit },
        {
          provide: EventService,
          useValue: {
            resolveAudience: jest.fn((d) =>
              Promise.resolve({
                audience: d.audience ?? 'EVERYONE',
                audienceGroupId: d.audienceGroupId ?? null,
              }),
            ),
          },
        },
      ],
    }).compile();
    service = module.get(EventTemplateService);
  });

  it('saves a trimmed service type with defaults', async () => {
    await service.create(dto, 'm-1');

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Midweek Bible Study',
        defaultRecurrence: null,
        autoProgramme: true,
      }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      'EVENT_TEMPLATE_SAVED',
      expect.anything(),
    );
  });

  it('rejects a duplicate name, ignoring case', async () => {
    mockRepo.findOne.mockResolvedValueOnce({
      id: 't-2',
      name: 'midweek bible study',
    });

    await expect(service.create(dto, 'm-1')).rejects.toThrow(ConflictException);
  });

  it('404s when deleting an unknown type', async () => {
    await expect(service.remove('x', 'm-1')).rejects.toThrow(NotFoundException);
  });
});
