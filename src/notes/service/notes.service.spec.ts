import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { NotesService } from './notes.service';
import { Note } from '../entity/note.entity';
import { NoteTypeEnum } from '../enums/note-type.enums';
import { AuditLogService } from '../../utility/service/audit-log.service';

const mockNoteRepo = {
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  remove: jest.fn(),
  findAndCount: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const MEMBER_1 = 'a3f2e1b4-9c7d-4e5f-8a6b-1c2d3e4f5a6b';
const MEMBER_2 = 'b4a3f2e1-8d6c-5f4e-7a9b-6c1d3e4f2a5b';

describe('NotesService', () => {
  let service: NotesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: getRepositoryToken(Note), useValue: mockNoteRepo },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<NotesService>(NotesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create — baptism', () => {
    it('creates a baptism note and logs NOTE_CREATED', async () => {
      mockNoteRepo.save.mockImplementation((n) =>
        Promise.resolve({ ...n, id: 'note-1' }),
      );

      const result = await service.create(
        {
          type: NoteTypeEnum.BAPTISM,
          personName: 'John Doe',
          baptismDate: '2026-06-15',
        } as any,
        'actor-1',
      );

      expect(result.type).toBe(NoteTypeEnum.BAPTISM);
      expect((result.details as any).personName).toBe('John Doe');
      expect(result.member).toBeNull();
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'NOTE_CREATED',
        expect.objectContaining({
          actorId: 'actor-1',
          metadata: { type: NoteTypeEnum.BAPTISM },
        }),
      );
    });

    it('links the note to a member when memberId is provided', async () => {
      mockNoteRepo.save.mockImplementation((n) =>
        Promise.resolve({ ...n, id: 'note-1' }),
      );

      const result = await service.create(
        {
          type: NoteTypeEnum.BAPTISM,
          personName: 'John Doe',
          baptismDate: '2026-06-15',
          memberId: MEMBER_1,
        } as any,
        'actor-1',
      );

      expect(result.member).toEqual({ id: MEMBER_1 });
    });

    it('throws when required baptism fields are missing', async () => {
      // validateOrReject rejects with a plain array of ValidationError, not
      // an Error instance, so .rejects.toThrow() won't recognize it.
      await expect(
        service.create(
          { type: NoteTypeEnum.BAPTISM, personName: '' } as any,
          'actor-1',
        ),
      ).rejects.toBeDefined();
    });
  });

  describe('update', () => {
    it('throws BadRequestException when type is not provided', async () => {
      await expect(
        service.update('note-1', {} as any, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('re-links member when memberId changes on update', async () => {
      mockNoteRepo.findOne.mockResolvedValue({
        id: 'note-1',
        type: NoteTypeEnum.BAPTISM,
        details: {
          type: NoteTypeEnum.BAPTISM,
          personName: 'John',
          baptismDate: new Date('2026-06-15'),
        },
        member: null,
      });
      mockNoteRepo.save.mockImplementation((n) => Promise.resolve(n));

      const result = await service.update(
        'note-1',
        { type: NoteTypeEnum.BAPTISM, memberId: MEMBER_2 } as any,
        'actor-1',
      );

      expect(result.member).toEqual({ id: MEMBER_2 });
    });

    it('unlinks the member when memberId is explicitly set to null', async () => {
      mockNoteRepo.findOne.mockResolvedValue({
        id: 'note-1',
        type: NoteTypeEnum.BAPTISM,
        details: {
          type: NoteTypeEnum.BAPTISM,
          personName: 'John',
          baptismDate: new Date('2026-06-15'),
        },
        member: { id: MEMBER_2 },
      });
      mockNoteRepo.save.mockImplementation((n) => Promise.resolve(n));

      const result = await service.update(
        'note-1',
        { type: NoteTypeEnum.BAPTISM, memberId: null } as any,
        'actor-1',
      );

      expect(result.member).toBeNull();
    });
  });

  describe('getMyMilestones', () => {
    it('returns notes linked to the given member, newest first', async () => {
      const notes = [{ id: 'note-1' }];
      mockNoteRepo.find.mockResolvedValue(notes);

      const result = await service.getMyMilestones(MEMBER_1);

      expect(mockNoteRepo.find).toHaveBeenCalledWith({
        where: { member: { id: MEMBER_1 } },
        order: { createdAt: 'DESC' },
      });
      expect(result).toBe(notes);
    });
  });
});
