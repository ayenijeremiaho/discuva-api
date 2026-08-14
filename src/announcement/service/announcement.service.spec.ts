import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AnnouncementService } from './announcement.service';
import { Announcement } from '../entity/announcement.entity';
import { AnnouncementReaction } from '../entity/announcement-reaction.entity';
import { ReactionEmojiEnum } from '../enum/reaction-emoji.enum';
import { AnnouncementAudienceEnum } from '../enum/announcement-audience.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { UtilityService } from '../../utility/service/utility.service';
import { SanitizationService } from '../../utility/service/sanitization.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { GroupService } from '../../group/service/group.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { SmsService } from '../../sms/service/sms.service';
import { Member } from '../../member/entity/member.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';

const noSmsAdmin = { id: 'admin-1', adminRole: { permissions: [] } } as any;
const smsAdmin = {
  id: 'admin-1',
  adminRole: { permissions: [AdminPermission.SMS_SEND] },
} as any;

jest.mock('../../utility/service/sanitization.service', () => ({
  SanitizationService: jest.fn().mockImplementation(() => ({
    sanitize: jest.fn((html: string) => html),
    sanitizeText: jest.fn((text: string) => text),
    sanitizeForEmail: jest.fn((html: string) => html),
  })),
}));

const mockSanitizationService = {
  sanitize: jest.fn((html: string) => html),
  sanitizeText: jest.fn((text: string) => text),
  sanitizeForEmail: jest.fn((html: string) => html),
};

const makeQb = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn(),
  getMany: jest.fn(),
});

const mockAuditLogService = { log: jest.fn() };

const mockGroupService = {
  getMemberIdsForGroup: jest.fn().mockResolvedValue([]),
  getPhoneOnlyNumbersForGroup: jest.fn().mockResolvedValue([]),
};

const mockPushNotificationService = {
  dispatchToMemberIds: jest.fn().mockResolvedValue(undefined),
};

const mockAnnouncementRepo = {
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockReactionRepo = {
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockMemberQb = {
  leftJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
};

const mockMemberRepo = {
  createQueryBuilder: jest.fn().mockReturnValue(mockMemberQb),
  find: jest.fn().mockResolvedValue([]),
};

const mockSmsService = {
  send: jest.fn().mockResolvedValue([]),
  assertConfigured: jest.fn().mockResolvedValue(undefined),
};

describe('AnnouncementService', () => {
  let service: AnnouncementService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementService,
        {
          provide: getRepositoryToken(Announcement),
          useValue: mockAnnouncementRepo,
        },
        {
          provide: getRepositoryToken(AnnouncementReaction),
          useValue: mockReactionRepo,
        },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        { provide: SanitizationService, useValue: mockSanitizationService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: GroupService, useValue: mockGroupService },
        {
          provide: PushNotificationService,
          useValue: mockPushNotificationService,
        },
        { provide: SmsService, useValue: mockSmsService },
      ],
    }).compile();

    service = module.get<AnnouncementService>(AnnouncementService);
  });

  describe('create', () => {
    it('should throw BadRequestException if audience is DEPARTMENT but no departmentId provided', async () => {
      await expect(
        service.create(
          {
            title: 'Dept Announcement',
            body: 'For the music department',
            audience: AnnouncementAudienceEnum.DEPARTMENT,
          } as any,
          'author-1',
          noSmsAdmin,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should save announcement with publishedAt defaulting to now when not specified', async () => {
      const before = new Date();
      const announcement = {
        id: 'ann-1',
        title: 'General Announcement',
        body: 'Hello everyone',
        audience: AnnouncementAudienceEnum.ALL,
        publishedAt: new Date(),
      };
      mockAnnouncementRepo.create.mockReturnValue(announcement);
      mockAnnouncementRepo.save.mockResolvedValue(announcement);

      await service.create(
        { title: 'General Announcement', body: 'Hello everyone' } as any,
        'author-1',
        noSmsAdmin,
      );

      const createCall = mockAnnouncementRepo.create.mock.calls[0][0];
      expect(createCall.publishedAt).toBeInstanceOf(Date);
      expect(createCall.publishedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
    });

    it('should save announcement for DEPARTMENT audience when departmentId is provided', async () => {
      const announcement = {
        id: 'ann-1',
        title: 'Music Dept',
        body: 'Meeting at 10am',
        audience: AnnouncementAudienceEnum.DEPARTMENT,
        department: { id: 'dept-1' },
      };
      mockAnnouncementRepo.create.mockReturnValue(announcement);
      mockAnnouncementRepo.save.mockResolvedValue(announcement);

      const result = await service.create(
        {
          title: 'Music Dept',
          body: 'Meeting at 10am',
          audience: AnnouncementAudienceEnum.DEPARTMENT,
          departmentId: 'dept-1',
        } as any,
        'author-1',
        noSmsAdmin,
      );

      expect(mockAnnouncementRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ department: { id: 'dept-1' } }),
      );
      expect(result).toMatchObject({ id: 'ann-1' });
    });

    it('should use provided publishedAt date when specified', async () => {
      const publishDate = '2025-07-01T10:00:00.000Z';
      const announcement = {
        id: 'ann-1',
        title: 'Scheduled',
        publishedAt: new Date(publishDate),
      };
      mockAnnouncementRepo.create.mockReturnValue(announcement);
      mockAnnouncementRepo.save.mockResolvedValue(announcement);

      await service.create(
        {
          title: 'Scheduled',
          body: 'Future announcement',
          publishedAt: publishDate,
        } as any,
        'author-1',
        noSmsAdmin,
      );

      expect(mockAnnouncementRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ publishedAt: new Date(publishDate) }),
      );
    });
  });

  describe('getForMember', () => {
    it('should filter to only ALL audience for MEMBER role', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      mockAnnouncementRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 10,
        totalCount: 0,
        totalPages: 1,
      });

      await service.getForMember(
        'member-1',
        MemberRoleEnum.MEMBER,
        null,
        1,
        10,
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('audience'),
        expect.objectContaining({ all: AnnouncementAudienceEnum.ALL }),
      );
    });

    it('should allow WORKER role to see ALL, WORKERS_ONLY, and their dept announcements', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[{ id: 'ann-1' }], 1]);
      mockAnnouncementRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [{ id: 'ann-1' } as any],
        page: 1,
        limit: 10,
        totalCount: 1,
        totalPages: 1,
      });

      await service.getForMember(
        'worker-1',
        MemberRoleEnum.WORKER,
        'dept-1',
        1,
        10,
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('audience'),
        expect.objectContaining({
          all: AnnouncementAudienceEnum.ALL,
          workers: AnnouncementAudienceEnum.WORKERS_ONLY,
          dept: AnnouncementAudienceEnum.DEPARTMENT,
          departmentId: 'dept-1',
        }),
      );
    });

    it('should exclude expired announcements by filtering expiresAt', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      mockAnnouncementRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [],
        page: 1,
        limit: 10,
        totalCount: 0,
        totalPages: 1,
      });

      await service.getForMember(
        'member-1',
        MemberRoleEnum.MEMBER,
        null,
        1,
        10,
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('expiresAt'),
        expect.objectContaining({ now: expect.any(Date) }),
      );
    });

    it('should return paginated results', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([
        [{ id: 'ann-1' }, { id: 'ann-2' }],
        2,
      ]);
      mockAnnouncementRepo.createQueryBuilder.mockReturnValue(qb);
      jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
        data: [{ id: 'ann-1' } as any, { id: 'ann-2' } as any],
        page: 1,
        limit: 10,
        totalCount: 2,
        totalPages: 1,
      });

      const result = await service.getForMember(
        'worker-1',
        MemberRoleEnum.WORKER,
        null,
        1,
        10,
      );

      expect(result.totalCount).toBe(2);
      expect(result.data).toHaveLength(2);
    });
  });

  describe('delete', () => {
    it('should throw NotFoundException if announcement not found', async () => {
      mockAnnouncementRepo.findOne.mockResolvedValue(null);

      await expect(service.delete('nonexistent-id', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should remove announcement when found', async () => {
      const announcement = { id: 'ann-1', title: 'Test', body: 'Content' };
      mockAnnouncementRepo.findOne.mockResolvedValue(announcement);
      mockAnnouncementRepo.remove.mockResolvedValue(undefined);

      await service.delete('ann-1', 'admin-1');

      expect(mockAnnouncementRepo.remove).toHaveBeenCalledWith(announcement);
    });

    it('should call findOne with correct id and relations', async () => {
      mockAnnouncementRepo.findOne.mockResolvedValue(null);

      await expect(service.delete('ann-1', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(mockAnnouncementRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'ann-1' },
        relations: ['author', 'department', 'targetMember', 'group'],
      });
    });
  });

  describe('push notification dispatch', () => {
    it('should throw BadRequestException if audience is GROUP but no groupId provided', async () => {
      await expect(
        service.create(
          {
            title: 'Group Announcement',
            body: 'For call leaders',
            audience: AnnouncementAudienceEnum.GROUP,
          } as any,
          'author-1',
          noSmsAdmin,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should save announcement with group set and dispatch a push notification to group members', async () => {
      const announcement = {
        id: 'ann-1',
        title: 'Call Leaders Meeting',
        body: 'Meeting moved to 6pm',
        audience: AnnouncementAudienceEnum.GROUP,
        group: { id: 'group-1' },
      };
      mockAnnouncementRepo.create.mockReturnValue(announcement);
      mockAnnouncementRepo.save.mockResolvedValue(announcement);
      mockGroupService.getMemberIdsForGroup.mockResolvedValue([
        'member-1',
        'member-2',
      ]);

      await service.create(
        {
          title: 'Call Leaders Meeting',
          body: 'Meeting moved to 6pm',
          audience: AnnouncementAudienceEnum.GROUP,
          groupId: 'group-1',
        } as any,
        'author-1',
        noSmsAdmin,
      );

      expect(mockAnnouncementRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ group: { id: 'group-1' } }),
      );
      await new Promise(process.nextTick);
      expect(mockGroupService.getMemberIdsForGroup).toHaveBeenCalledWith(
        'group-1',
      );
      expect(
        mockPushNotificationService.dispatchToMemberIds,
      ).toHaveBeenCalledWith(
        ['member-1', 'member-2'],
        expect.objectContaining({
          idempotencyKey: 'ann-1',
          title: 'Call Leaders Meeting',
          url: '/announcements',
        }),
      );
    });

    it('dispatches a push notification for ALL audience by resolving active members', async () => {
      const announcement = {
        id: 'ann-2',
        title: 'General',
        body: 'Hello',
        audience: AnnouncementAudienceEnum.ALL,
      };
      mockAnnouncementRepo.create.mockReturnValue(announcement);
      mockAnnouncementRepo.save.mockResolvedValue(announcement);
      mockMemberQb.getMany.mockResolvedValueOnce([
        { id: 'member-3' },
        { id: 'member-4' },
      ]);

      await service.create(
        { title: 'General', body: 'Hello' } as any,
        'author-1',
        noSmsAdmin,
      );

      await new Promise(process.nextTick);
      expect(mockGroupService.getMemberIdsForGroup).not.toHaveBeenCalled();
      expect(
        mockPushNotificationService.dispatchToMemberIds,
      ).toHaveBeenCalledWith(
        ['member-3', 'member-4'],
        expect.objectContaining({
          idempotencyKey: 'ann-2',
          title: 'General',
          url: '/announcements',
        }),
      );
    });

    it('does not dispatch a push notification when no eligible members are resolved', async () => {
      const announcement = {
        id: 'ann-3',
        title: 'Empty',
        body: 'Nobody',
        audience: AnnouncementAudienceEnum.ALL,
      };
      mockAnnouncementRepo.create.mockReturnValue(announcement);
      mockAnnouncementRepo.save.mockResolvedValue(announcement);
      mockMemberQb.getMany.mockResolvedValueOnce([]);

      await service.create(
        { title: 'Empty', body: 'Nobody' } as any,
        'author-1',
        noSmsAdmin,
      );

      await new Promise(process.nextTick);
      expect(
        mockPushNotificationService.dispatchToMemberIds,
      ).not.toHaveBeenCalled();
    });
  });

  describe('createSystemAnnouncement', () => {
    it('creates an ALL-audience announcement with no author and dispatches a push notification', async () => {
      const announcement = {
        id: 'sys-1',
        title: '🔴 Live Now',
        body: 'Join us — https://youtube.com/watch?v=abc',
        audience: AnnouncementAudienceEnum.ALL,
        author: null,
      };
      mockAnnouncementRepo.create.mockReturnValue(announcement);
      mockAnnouncementRepo.save.mockResolvedValue(announcement);
      mockMemberQb.getMany.mockResolvedValueOnce([{ id: 'member-5' }]);

      const result = await service.createSystemAnnouncement(
        '🔴 Live Now',
        'Join us — https://youtube.com/watch?v=abc',
      );

      expect(mockAnnouncementRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          audience: AnnouncementAudienceEnum.ALL,
          author: null,
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'ANNOUNCEMENT_CREATED',
        expect.objectContaining({
          targetId: 'sys-1',
          metadata: expect.objectContaining({ system: true }),
        }),
      );
      await new Promise(process.nextTick);
      expect(
        mockPushNotificationService.dispatchToMemberIds,
      ).toHaveBeenCalledWith(['member-5'], expect.any(Object));
      expect(result).toBe(announcement);
    });
  });

  describe('sendViaSms', () => {
    it('rejects sendViaSms=true when the admin lacks SMS_SEND', async () => {
      await expect(
        service.create(
          { title: 'T', body: 'B', sendViaSms: true } as any,
          'author-1',
          noSmsAdmin,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects sendViaSms=true, before persisting anything, when no SMS provider is configured', async () => {
      mockSmsService.assertConfigured.mockRejectedValueOnce(
        new ForbiddenException({
          message: 'No SMS provider configured.',
          code: 'SMS_PROVIDER_NOT_CONFIGURED',
        }),
      );

      await expect(
        service.create(
          { title: 'T', body: 'B', sendViaSms: true, smsBody: 'Hi' } as any,
          'author-1',
          smsAdmin,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockAnnouncementRepo.save).not.toHaveBeenCalled();
    });

    it('dispatches SMS to resolved phone numbers using the dedicated smsBody', async () => {
      const announcement = {
        id: 'ann-1',
        title: 'T',
        body: 'B'.repeat(500),
        audience: AnnouncementAudienceEnum.ALL,
        sendViaSms: true,
        smsBody: 'Short SMS text',
      };
      mockAnnouncementRepo.create.mockReturnValue(announcement);
      mockAnnouncementRepo.save.mockResolvedValue(announcement);
      mockMemberQb.getMany.mockResolvedValue([
        { phoneNumber: '+1' },
        { phoneNumber: null },
        { phoneNumber: '+2' },
      ]);

      await service.create(
        {
          title: 'T',
          body: 'B'.repeat(500),
          sendViaSms: true,
          smsBody: 'Short SMS text',
        } as any,
        'author-1',
        smsAdmin,
      );

      expect(mockSmsService.send).toHaveBeenCalledWith(
        ['+1', '+2'],
        'Short SMS text',
      );
    });

    it('does not dispatch SMS when sendViaSms is false', async () => {
      const announcement = {
        id: 'ann-1',
        title: 'T',
        body: 'B',
        audience: AnnouncementAudienceEnum.ALL,
        sendViaSms: false,
      };
      mockAnnouncementRepo.create.mockReturnValue(announcement);
      mockAnnouncementRepo.save.mockResolvedValue(announcement);

      await service.create(
        { title: 'T', body: 'B' } as any,
        'author-1',
        noSmsAdmin,
      );

      expect(mockSmsService.send).not.toHaveBeenCalled();
    });

    it('swallows an SMS dispatch failure instead of failing announcement creation', async () => {
      const announcement = {
        id: 'ann-1',
        title: 'T',
        body: 'B',
        audience: AnnouncementAudienceEnum.ALL,
        sendViaSms: true,
        smsBody: 'Short SMS text',
      };
      mockAnnouncementRepo.create.mockReturnValue(announcement);
      mockAnnouncementRepo.save.mockResolvedValue(announcement);
      mockMemberQb.getMany.mockResolvedValue([{ phoneNumber: '+1' }]);
      mockSmsService.send.mockRejectedValueOnce(new Error('provider down'));

      await expect(
        service.create(
          {
            title: 'T',
            body: 'B',
            sendViaSms: true,
            smsBody: 'Short SMS text',
          } as any,
          'author-1',
          smsAdmin,
        ),
      ).resolves.toMatchObject({ id: 'ann-1' });
    });
  });

  describe('sendSmsBroadcast', () => {
    it('rejects DEPARTMENT audience without a departmentId', async () => {
      await expect(
        service.sendSmsBroadcast(
          {
            audience: AnnouncementAudienceEnum.DEPARTMENT,
            message: 'Hi',
          } as any,
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects INDIVIDUAL audience without a targetMemberId', async () => {
      await expect(
        service.sendSmsBroadcast(
          {
            audience: AnnouncementAudienceEnum.INDIVIDUAL,
            message: 'Hi',
          } as any,
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects GROUP audience without a groupId', async () => {
      await expect(
        service.sendSmsBroadcast(
          { audience: AnnouncementAudienceEnum.GROUP, message: 'Hi' } as any,
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('sends SMS to resolved phone numbers and logs the audit entry without creating an announcement', async () => {
      mockMemberQb.getMany.mockResolvedValue([
        { phoneNumber: '+1' },
        { phoneNumber: null },
        { phoneNumber: '+2' },
      ]);

      const result = await service.sendSmsBroadcast(
        {
          audience: AnnouncementAudienceEnum.ALL,
          message: 'Reminder: service starts at 9am',
        } as any,
        'admin-1',
      );

      expect(mockSmsService.send).toHaveBeenCalledWith(
        ['+1', '+2'],
        'Reminder: service starts at 9am',
      );
      expect(mockAnnouncementRepo.save).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'SMS_BROADCAST_SENT',
        expect.objectContaining({
          actorId: 'admin-1',
          metadata: { audience: AnnouncementAudienceEnum.ALL, count: 2 },
        }),
      );
      expect(result).toEqual({ sentCount: 2 });
    });

    it('returns sentCount 0 and does not call the SMS provider when no recipients resolve', async () => {
      mockMemberQb.getMany.mockResolvedValue([]);

      const result = await service.sendSmsBroadcast(
        { audience: AnnouncementAudienceEnum.ALL, message: 'Hi' } as any,
        'admin-1',
      );

      expect(mockSmsService.send).not.toHaveBeenCalled();
      expect(result).toEqual({ sentCount: 0 });
    });

    it('unions member-derived phones with phone-only group entries and dedupes', async () => {
      mockGroupService.getMemberIdsForGroup.mockResolvedValue(['member-1']);
      mockMemberRepo.find.mockResolvedValue([
        { phoneNumber: '+1' },
        { phoneNumber: '+2' },
      ]);
      mockGroupService.getPhoneOnlyNumbersForGroup.mockResolvedValue([
        '+2',
        '+3',
      ]);

      const result = await service.sendSmsBroadcast(
        {
          audience: AnnouncementAudienceEnum.GROUP,
          groupId: 'group-1',
          message: 'Welcome back!',
        } as any,
        'admin-1',
      );

      expect(mockGroupService.getPhoneOnlyNumbersForGroup).toHaveBeenCalledWith(
        'group-1',
      );
      expect(mockSmsService.send).toHaveBeenCalledWith(
        expect.arrayContaining(['+1', '+2', '+3']),
        'Welcome back!',
      );
      expect(mockSmsService.send.mock.calls[0][0]).toHaveLength(3);
      expect(result).toEqual({ sentCount: 3 });
    });

    it('reaches phone-only entries even when the group has no real Members', async () => {
      mockGroupService.getMemberIdsForGroup.mockResolvedValue([]);
      mockGroupService.getPhoneOnlyNumbersForGroup.mockResolvedValue(['+9']);

      const result = await service.sendSmsBroadcast(
        {
          audience: AnnouncementAudienceEnum.GROUP,
          groupId: 'group-1',
          message: 'Hi first-timer',
        } as any,
        'admin-1',
      );

      expect(mockMemberRepo.find).not.toHaveBeenCalled();
      expect(mockSmsService.send).toHaveBeenCalledWith(
        ['+9'],
        'Hi first-timer',
      );
      expect(result).toEqual({ sentCount: 1 });
    });
  });

  describe('react', () => {
    it('throws NotFoundException when the announcement does not exist', async () => {
      mockAnnouncementRepo.findOne.mockResolvedValue(null);

      await expect(
        service.react('missing', 'member-1', { emoji: ReactionEmojiEnum.PRAY }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a new reaction when none exists', async () => {
      mockAnnouncementRepo.findOne.mockResolvedValue({ id: 'ann-1' });
      mockReactionRepo.findOne.mockResolvedValue(null);
      const created = { id: 'react-1', emoji: ReactionEmojiEnum.PRAY };
      mockReactionRepo.create.mockReturnValue(created);
      mockReactionRepo.save.mockResolvedValue(created);

      const result = await service.react('ann-1', 'member-1', {
        emoji: ReactionEmojiEnum.PRAY,
      });

      expect(mockReactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          announcement: { id: 'ann-1' },
          member: { id: 'member-1' },
          emoji: ReactionEmojiEnum.PRAY,
        }),
      );
      expect(result).toEqual(created);
    });

    it('updates the emoji when a reaction already exists for that member', async () => {
      mockAnnouncementRepo.findOne.mockResolvedValue({ id: 'ann-1' });
      const existing = { id: 'react-1', emoji: ReactionEmojiEnum.THUMBS_UP };
      mockReactionRepo.findOne.mockResolvedValue(existing);
      mockReactionRepo.save.mockImplementation((r) => Promise.resolve(r));

      const result = await service.react('ann-1', 'member-1', {
        emoji: ReactionEmojiEnum.HEART,
      });

      expect(mockReactionRepo.create).not.toHaveBeenCalled();
      expect(result.emoji).toBe(ReactionEmojiEnum.HEART);
    });
  });

  describe('removeReaction', () => {
    it('deletes the reaction for that member/announcement pair', async () => {
      mockReactionRepo.delete.mockResolvedValue({ affected: 1 });

      await service.removeReaction('ann-1', 'member-1');

      expect(mockReactionRepo.delete).toHaveBeenCalledWith({
        announcement: { id: 'ann-1' },
        member: { id: 'member-1' },
      });
    });
  });

  describe('getReactionSummary', () => {
    it('returns emoji counts grouped from the query builder, with myReaction null when no memberId given', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { emoji: ReactionEmojiEnum.PRAY, count: '5' },
          { emoji: ReactionEmojiEnum.HEART, count: '2' },
        ]),
      };
      mockReactionRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getReactionSummary('ann-1');

      expect(result.summary).toEqual([
        { emoji: ReactionEmojiEnum.PRAY, count: 5 },
        { emoji: ReactionEmojiEnum.HEART, count: 2 },
      ]);
      expect(result.myReaction).toBeNull();
      expect(mockReactionRepo.findOne).not.toHaveBeenCalled();
    });

    it("includes the caller's own reaction when memberId is given", async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      mockReactionRepo.createQueryBuilder.mockReturnValue(qb);
      mockReactionRepo.findOne.mockResolvedValue({
        emoji: ReactionEmojiEnum.CLAP,
      });

      const result = await service.getReactionSummary('ann-1', 'member-1');

      expect(result.myReaction).toBe(ReactionEmojiEnum.CLAP);
    });
  });
});
