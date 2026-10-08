import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { NotesService, TOP_SCRIPTURE_MIN_MEMBERS } from './notes.service';
import { Note } from '../entity/note.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { Sermon } from '../../sermon/entity/sermon.entity';
import { ChurchTimezoneService } from '../../event/service/church-timezone.service';
import { CacheService } from '../../utility/service/cache.service';
import { NoteKindEnum } from '../enum/note-kind.enum';
import { NoteNode } from '../util/note-content';

const doc = (...texts: string[]): NoteNode => ({
  type: 'doc',
  content: texts.map((text) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  })),
});

describe('NotesService', () => {
  let service: NotesService;

  const noteRepo = {
    findOne: jest.fn(),
    create: jest.fn((v) => ({ ...v })),
    save: jest.fn(async (v) => ({ id: 'note-1', ...v })),
    delete: jest.fn(),
  };
  const slotRepo = { findOne: jest.fn() };
  const sermonRepo = { findOne: jest.fn(), exists: jest.fn() };
  const churchTimezone = { get: jest.fn().mockResolvedValue('Africa/Lagos') };
  const query = jest.fn();
  const txHost = { tx: { query: (...a: unknown[]) => query(...a) } };
  const cacheService = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(1),
    key: jest.fn().mockReturnValue('cache-key'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    cacheService.get.mockResolvedValue(undefined);
    noteRepo.create.mockImplementation((v) => ({ ...v }));
    noteRepo.save.mockImplementation(async (v) => ({ id: 'note-1', ...v }));
    const module = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: getRepositoryToken(Note), useValue: noteRepo },
        { provide: getRepositoryToken(ServiceSlot), useValue: slotRepo },
        { provide: getRepositoryToken(Sermon), useValue: sermonRepo },
        { provide: ChurchTimezoneService, useValue: churchTimezone },
        { provide: TransactionHost, useValue: txHost },
        { provide: CacheService, useValue: cacheService },
      ],
    }).compile();
    service = module.get(NotesService);
  });

  describe('create', () => {
    it('derives text, refs and commitment from the content', async () => {
      const content: NoteNode = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'scripture',
                attrs: { ref: 'ROM.8.28', label: 'Romans 8:28' },
              },
            ],
          },
          {
            type: 'heading',
            attrs: { promptId: 'action' },
            content: [{ type: 'text', text: 'Do' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Pray daily' }],
          },
        ],
      };
      const note = await service.create('m1', { content });
      expect(note).toMatchObject({
        memberId: 'm1',
        kind: NoteKindEnum.PERSONAL,
        scriptureRefs: ['ROM.8.28'],
        commitment: 'Pray daily',
      });
      expect(note.plainText).toContain('Romans 8:28');
      expect(cacheService.del).toHaveBeenCalled();
    });

    it('returns the existing note when starting notes for the same service again', async () => {
      noteRepo.findOne.mockResolvedValueOnce({ id: 'existing' });
      const note = await service.create('m1', {
        content: doc('x'),
        serviceSlotId: 'slot-1',
      });
      expect(note).toEqual({ id: 'existing' });
      expect(noteRepo.save).not.toHaveBeenCalled();
    });

    it('links a new service note to its event and titles it after the event', async () => {
      noteRepo.findOne.mockResolvedValueOnce(null);
      slotRepo.findOne.mockResolvedValueOnce({
        id: 'slot-1',
        event: { id: 'event-1', name: 'Sunday Service' },
      });
      const note = await service.create('m1', {
        content: doc('x'),
        serviceSlotId: 'slot-1',
      });
      expect(note).toMatchObject({
        serviceSlotId: 'slot-1',
        eventId: 'event-1',
        kind: NoteKindEnum.SERMON,
        title: 'Sunday Service',
      });
    });

    it('returns the winner when two starts for the same service race', async () => {
      noteRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'winner' });
      slotRepo.findOne.mockResolvedValueOnce({
        id: 'slot-1',
        event: { id: 'event-1', name: 'Sunday Service' },
      });
      noteRepo.save.mockRejectedValueOnce({ code: '23505' });
      await expect(
        service.create('m1', { content: doc('x'), serviceSlotId: 'slot-1' }),
      ).resolves.toEqual({ id: 'winner' });
    });

    it('rejects content that is not a document', async () => {
      await expect(
        service.create('m1', { content: { type: 'paragraph' } }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects content over the size limit', async () => {
      await expect(
        service.create('m1', { content: doc('x'.repeat(210_000)) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    const saved = {
      id: 'n1',
      memberId: 'm1',
      title: 'Old',
      updatedAt: new Date('2026-10-08T10:00:00.000Z'),
    };

    it('refuses an edit based on an older copy', async () => {
      noteRepo.findOne.mockResolvedValueOnce({ ...saved });
      await expect(
        service.update('m1', 'n1', {
          content: doc('new'),
          baseUpdatedAt: '2026-10-08T09:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('saves an edit based on the latest copy', async () => {
      noteRepo.findOne.mockResolvedValueOnce({ ...saved });
      const note = await service.update('m1', 'n1', {
        content: doc('new'),
        baseUpdatedAt: '2026-10-08T10:00:00.000Z',
      });
      expect(note.plainText).toBe('new');
    });

    it('lets pinning through without a conflict check', async () => {
      noteRepo.findOne.mockResolvedValueOnce({ ...saved });
      const note = await service.update('m1', 'n1', {
        pinned: true,
        baseUpdatedAt: '2026-10-01T00:00:00.000Z',
      });
      expect(note.pinned).toBe(true);
    });

    it("can't reach another member's note", async () => {
      noteRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.update('m2', 'n1', { title: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(noteRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'n1', memberId: 'm2' },
      });
    });
  });

  it('remove only deletes the caller’s own note', async () => {
    noteRepo.delete.mockResolvedValueOnce({ affected: 0 });
    await expect(service.remove('m2', 'n1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(noteRepo.delete).toHaveBeenCalledWith({ id: 'n1', memberId: 'm2' });
  });

  it('list scopes to the member and escapes search wildcards', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);
    await service.list('m1', { page: 1, limit: 20, q: '50%_off' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('n.member_id = $1');
    expect(params).toEqual(['m1', '%50\\%\\_off%']);
  });

  it('only reports verses noted by enough members to stay anonymous', async () => {
    query.mockResolvedValueOnce([{ ref: 'ROM.8.28', count: 4 }]);
    await expect(service.topScriptures('e1')).resolves.toEqual([
      { ref: 'ROM.8.28', count: 4 },
    ]);
    expect(query.mock.calls[0][1]).toEqual(['e1', TOP_SCRIPTURE_MIN_MEMBERS]);
  });

  it('builds the streak from cached weeks without querying', async () => {
    cacheService.get.mockResolvedValueOnce({ weeks: [] });
    await expect(service.streak('m1')).resolves.toMatchObject({ current: 0 });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns no context when no service is on today', async () => {
    query.mockResolvedValueOnce([]);
    await expect(service.context('m1')).resolves.toBeNull();
  });

  it('context includes the speaker, same-day sermon and existing note', async () => {
    query
      .mockResolvedValueOnce([
        {
          id: 'slot-1',
          name: 'First Service',
          startTime: new Date(),
          endTime: new Date(),
          eventId: 'e1',
          eventName: 'Sunday Service',
          checkedIn: true,
          isLive: true,
        },
      ])
      .mockResolvedValueOnce([{ name: 'Jane Doe', topic: 'Faith' }])
      .mockResolvedValueOnce([
        { id: 's1', title: 'Faith', speakerName: 'Jane Doe', series: null },
      ]);
    noteRepo.findOne.mockResolvedValueOnce({ id: 'n1' });
    await expect(service.context('m1')).resolves.toMatchObject({
      isLive: true,
      checkedIn: true,
      speaker: { name: 'Jane Doe', topic: 'Faith' },
      sermon: { id: 's1' },
      noteId: 'n1',
    });
  });

  it('keeps the old sermon note routes working on top of notes', async () => {
    sermonRepo.findOne.mockResolvedValueOnce({ id: 's1', title: 'Faith' });
    noteRepo.findOne.mockResolvedValueOnce(null);
    const legacy = await service.upsertLegacySermonNote('s1', 'm1', 'a\nb');
    expect(legacy.note).toBe('a\nb');
    expect(noteRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ sermonId: 's1', kind: NoteKindEnum.SERMON }),
    );
  });

  describe('linking a service', () => {
    const owned = { id: 'n1', memberId: 'm1', updatedAt: new Date() };

    it('links a note to a service and returns its names', async () => {
      noteRepo.findOne
        .mockResolvedValueOnce({ ...owned })
        .mockResolvedValueOnce(null);
      slotRepo.findOne.mockResolvedValueOnce({
        id: 'slot-1',
        event: { id: 'e1' },
      });
      query.mockResolvedValueOnce([
        {
          serviceSlotId: 'slot-1',
          serviceName: 'First Service',
          eventId: 'e1',
          eventName: 'Sunday Service',
          startTime: new Date(),
        },
      ]);
      const note = await service.update('m1', 'n1', {
        serviceSlotId: 'slot-1',
      });
      expect(note).toMatchObject({
        serviceSlotId: 'slot-1',
        eventId: 'e1',
        service: { eventName: 'Sunday Service', serviceName: 'First Service' },
      });
    });

    it('refuses a service that already has another of the member’s notes', async () => {
      noteRepo.findOne
        .mockResolvedValueOnce({ ...owned })
        .mockResolvedValueOnce({ id: 'other' });
      slotRepo.findOne.mockResolvedValueOnce({
        id: 'slot-1',
        event: { id: 'e1' },
      });
      await expect(
        service.update('m1', 'n1', { serviceSlotId: 'slot-1' }),
      ).rejects.toMatchObject({
        response: { code: 'NOTE_SERVICE_TAKEN', noteId: 'other' },
      });
      expect(noteRepo.save).not.toHaveBeenCalled();
    });

    it('unlinks with null', async () => {
      noteRepo.findOne.mockResolvedValueOnce({
        ...owned,
        serviceSlotId: 'slot-1',
        eventId: 'e1',
      });
      const note = await service.update('m1', 'n1', { serviceSlotId: null });
      expect(note).toMatchObject({
        serviceSlotId: null,
        eventId: null,
        service: null,
      });
    });

    it('lists recent services scoped to the member', async () => {
      query.mockResolvedValueOnce([]);
      await service.linkableServices('m1');
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("e.audience = 'EVERYONE' OR a.id IS NOT NULL");
      expect(sql).toContain('n.member_id = $1');
      expect(params).toEqual(['m1', 35]);
    });
  });

  it('links a sermon and returns its details', async () => {
    noteRepo.findOne.mockResolvedValueOnce({
      id: 'n1',
      memberId: 'm1',
      kind: 'personal',
      updatedAt: new Date(),
    });
    sermonRepo.exists.mockResolvedValueOnce(true);
    query.mockResolvedValueOnce([
      { id: 's1', title: 'Faith', speakerName: 'Jane Doe', date: new Date() },
    ]);
    const note = await service.update('m1', 'n1', { sermonId: 's1' });
    expect(note).toMatchObject({
      sermonId: 's1',
      kind: 'personal',
      sermon: { title: 'Faith' },
    });
  });
});
