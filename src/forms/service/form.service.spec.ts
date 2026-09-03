import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FormService } from './form.service';
import { Form } from '../entity/form.entity';
import { FormField } from '../entity/form-field.entity';
import { FormSubmission } from '../entity/form-submission.entity';
import {
  FormFieldAutoFill,
  FormFieldType,
  FormVisibility,
} from '../enum/form.enum';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

const mockFormRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'form-1', ...v })),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  remove: jest.fn(),
};
const mockFieldRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve(v)),
  remove: jest.fn(),
};
const mockSubmissionRepo = {
  findAndCount: jest.fn(),
  find: jest.fn(),
};
const mockCloudinaryService = {
  uploadBuffer: jest.fn(),
  deleteByPublicId: jest.fn(),
};

describe('FormService', () => {
  let service: FormService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormService,
        { provide: getRepositoryToken(Form), useValue: mockFormRepo },
        { provide: getRepositoryToken(FormField), useValue: mockFieldRepo },
        {
          provide: getRepositoryToken(FormSubmission),
          useValue: mockSubmissionRepo,
        },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
      ],
    }).compile();
    service = module.get(FormService);
  });

  describe('create', () => {
    it('creates a form with its fields in one call', async () => {
      const result = await service.create({
        title: 'Volunteer Sign-up',
        visibility: FormVisibility.MEMBERS,
        fields: [
          {
            label: 'Name',
            description: 'Enter your legal name as it appears on your ID',
            fieldType: FormFieldType.TEXT,
            required: true,
          },
          {
            label: 'Team',
            fieldType: FormFieldType.DROPDOWN,
            options: ['Ushering', 'Choir'],
          },
        ],
      });

      // A separate fieldRepo.save() call, not a cascade off formRepo.save —
      // see the comment on Form.fields for why cascading here throws a
      // TypeORM "Cyclic dependency: FormField" error.
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Volunteer Sign-up',
          visibility: FormVisibility.MEMBERS,
        }),
      );
      expect(mockFieldRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            label: 'Name',
            description: 'Enter your legal name as it appears on your ID',
            required: true,
          }),
        ]),
      );
      expect(result.title).toBe('Volunteer Sign-up');
      expect(result.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: 'Name', required: true }),
        ]),
      );
    });

    it('rejects createsFirstTimers on a non-PUBLIC form', async () => {
      await expect(
        service.create({
          title: 'New Here?',
          visibility: FormVisibility.MEMBERS,
          createsFirstTimers: true,
          fields: [
            {
              label: 'First Name',
              fieldType: FormFieldType.TEXT,
              required: true,
              autoFillKey: FormFieldAutoFill.FIRST_NAME,
            },
            {
              label: 'Last Name',
              fieldType: FormFieldType.TEXT,
              required: true,
              autoFillKey: FormFieldAutoFill.LAST_NAME,
            },
            {
              label: 'Phone',
              fieldType: FormFieldType.PHONE,
              required: true,
              autoFillKey: FormFieldAutoFill.PHONE_NUMBER,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects createsFirstTimers when a required autoFillKey field is missing', async () => {
      await expect(
        service.create({
          title: 'New Here?',
          visibility: FormVisibility.PUBLIC,
          createsFirstTimers: true,
          fields: [
            {
              label: 'First Name',
              fieldType: FormFieldType.TEXT,
              required: true,
              autoFillKey: FormFieldAutoFill.FIRST_NAME,
            },
            // LAST_NAME and PHONE_NUMBER missing
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects createsFirstTimers when the mapped field is not marked required', async () => {
      await expect(
        service.create({
          title: 'New Here?',
          visibility: FormVisibility.PUBLIC,
          createsFirstTimers: true,
          fields: [
            {
              label: 'First Name',
              fieldType: FormFieldType.TEXT,
              required: false, // not required — should be rejected
              autoFillKey: FormFieldAutoFill.FIRST_NAME,
            },
            {
              label: 'Last Name',
              fieldType: FormFieldType.TEXT,
              required: true,
              autoFillKey: FormFieldAutoFill.LAST_NAME,
            },
            {
              label: 'Phone',
              fieldType: FormFieldType.PHONE,
              required: true,
              autoFillKey: FormFieldAutoFill.PHONE_NUMBER,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts createsFirstTimers when PUBLIC and all three required fields are mapped', async () => {
      const result = await service.create({
        title: 'New Here?',
        visibility: FormVisibility.PUBLIC,
        createsFirstTimers: true,
        fields: [
          {
            label: 'First Name',
            fieldType: FormFieldType.TEXT,
            required: true,
            autoFillKey: FormFieldAutoFill.FIRST_NAME,
          },
          {
            label: 'Last Name',
            fieldType: FormFieldType.TEXT,
            required: true,
            autoFillKey: FormFieldAutoFill.LAST_NAME,
          },
          {
            label: 'Phone',
            fieldType: FormFieldType.PHONE,
            required: true,
            autoFillKey: FormFieldAutoFill.PHONE_NUMBER,
          },
        ],
      });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ createsFirstTimers: true }),
      );
      expect(result.title).toBe('New Here?');
    });
  });

  describe('update', () => {
    it('diff-syncs fields: updates existing by id, adds new, deletes missing', async () => {
      const existingField = { id: 'field-1', label: 'Old Label' } as FormField;
      const staleField = { id: 'field-2', label: 'Stale' } as FormField;
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Old Title',
        fields: [existingField, staleField],
      });

      await service.update('form-1', {
        fields: [
          { id: 'field-1', label: 'New Label', fieldType: FormFieldType.TEXT },
          { label: 'Brand New Field', fieldType: FormFieldType.NUMBER },
        ],
      });

      expect(mockFieldRepo.remove).toHaveBeenCalledWith([staleField]);
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({ id: 'field-1', label: 'New Label' }),
            expect.objectContaining({ label: 'Brand New Field' }),
          ]),
        }),
      );
    });

    it('leaves fields untouched when the update omits them', async () => {
      const existingField = { id: 'field-1', label: 'Keep Me' } as FormField;
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Old Title',
        fields: [existingField],
      });

      await service.update('form-1', { title: 'New Title' });

      expect(mockFieldRepo.remove).not.toHaveBeenCalled();
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Title',
          fields: [existingField],
        }),
      );
    });

    it('throws NotFoundException for an unknown form', async () => {
      mockFormRepo.findOne.mockResolvedValue(null);
      await expect(service.update('missing', { title: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('validates the merged final state, not just the incoming patch, when enabling createsFirstTimers', async () => {
      // Existing form is MEMBERS-visibility with no autoFillKey fields —
      // flipping createsFirstTimers on without also fixing visibility/fields
      // must still be rejected, even though the DTO itself only touches
      // createsFirstTimers.
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.MEMBERS,
        fields: [
          { id: 'f1', label: 'Name', required: true, autoFillKey: null },
        ],
      });

      await expect(
        service.update('form-1', { createsFirstTimers: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows enabling createsFirstTimers when the form was already PUBLIC with the right fields', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [
          {
            id: 'f1',
            label: 'First Name',
            required: true,
            autoFillKey: FormFieldAutoFill.FIRST_NAME,
          },
          {
            id: 'f2',
            label: 'Last Name',
            required: true,
            autoFillKey: FormFieldAutoFill.LAST_NAME,
          },
          {
            id: 'f3',
            label: 'Phone',
            required: true,
            autoFillKey: FormFieldAutoFill.PHONE_NUMBER,
          },
        ],
      });

      await expect(
        service.update('form-1', { createsFirstTimers: true }),
      ).resolves.toBeDefined();
    });
  });

  describe('getSubmissionsCsv', () => {
    it('builds a CSV with one column per field, ordered, and escapes quotes', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        fields: [
          { id: 'f1', label: 'Name', order: 0 },
          { id: 'f2', label: 'Says "Hi"', order: 1 },
        ],
      });
      mockSubmissionRepo.find.mockResolvedValue([
        {
          createdAt: new Date('2026-01-01T00:00:00Z'),
          member: { firstname: 'Ada', lastname: 'Lovelace' },
          answers: { f1: 'Ada', f2: 'Says "Hi" back' },
        },
        {
          createdAt: new Date('2026-01-02T00:00:00Z'),
          member: null,
          answers: { f1: 'Anonymous', f2: null },
        },
      ]);

      const csv = await service.getSubmissionsCsv('form-1');

      expect(csv).toContain('"Name"');
      expect(csv).toContain('"Says ""Hi"""');
      expect(csv).toContain('"Ada Lovelace"');
      expect(csv).toContain('"Public"');
    });
  });

  describe('getAnalytics', () => {
    it('breaks down DROPDOWN/CHECKBOX fields into per-option counts and percentages', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Volunteer Sign-up',
        fields: [
          {
            id: 'f1',
            label: 'Team',
            fieldType: FormFieldType.DROPDOWN,
            options: ['Ushering', 'Choir'],
            order: 0,
          },
        ],
      });
      mockSubmissionRepo.find.mockResolvedValue([
        { answers: { f1: 'Ushering' } },
        { answers: { f1: 'Ushering' } },
        { answers: { f1: 'Choir' } },
      ]);

      const result = await service.getAnalytics('form-1');

      expect(result.totalSubmissions).toBe(3);
      expect(result.fields[0].responseCount).toBe(3);
      expect(result.fields[0].choices).toEqual(
        expect.arrayContaining([
          { option: 'Ushering', count: 2, percentage: 66.7 },
          { option: 'Choir', count: 1, percentage: 33.3 },
        ]),
      );
    });

    it('counts every selected value for CHECKBOX multi-select answers', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Interests',
        fields: [
          {
            id: 'f1',
            label: 'Interests',
            fieldType: FormFieldType.CHECKBOX,
            options: ['Music', 'Media', 'Ushering'],
            order: 0,
          },
        ],
      });
      mockSubmissionRepo.find.mockResolvedValue([
        { answers: { f1: ['Music', 'Media'] } },
        { answers: { f1: ['Music'] } },
      ]);

      const result = await service.getAnalytics('form-1');

      const music = result.fields[0].choices?.find((c) => c.option === 'Music');
      const media = result.fields[0].choices?.find((c) => c.option === 'Media');
      expect(music?.count).toBe(2);
      expect(media?.count).toBe(1);
    });

    it('computes average/min/max for NUMBER fields', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Feedback',
        fields: [
          {
            id: 'f1',
            label: 'Rating',
            fieldType: FormFieldType.NUMBER,
            order: 0,
          },
        ],
      });
      mockSubmissionRepo.find.mockResolvedValue([
        { answers: { f1: 5 } },
        { answers: { f1: 3 } },
        { answers: { f1: 4 } },
      ]);

      const result = await service.getAnalytics('form-1');

      expect(result.fields[0].average).toBe(4);
      expect(result.fields[0].min).toBe(3);
      expect(result.fields[0].max).toBe(5);
    });

    it('returns sample answers for free-text fields, most recent first, capped, and skips blanks', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Feedback',
        fields: [
          {
            id: 'f1',
            label: 'Comments',
            fieldType: FormFieldType.TEXTAREA,
            order: 0,
          },
        ],
      });
      mockSubmissionRepo.find.mockResolvedValue([
        { answers: { f1: 'Great service!' } },
        { answers: { f1: null } },
        { answers: { f1: '' } },
        { answers: { f1: 'Loved it' } },
      ]);

      const result = await service.getAnalytics('form-1');

      expect(result.fields[0].responseCount).toBe(2);
      expect(result.fields[0].sampleAnswers).toEqual([
        'Great service!',
        'Loved it',
      ]);
    });
  });

  describe('delete', () => {
    it('throws NotFoundException for an unknown form', async () => {
      mockFormRepo.findOne.mockResolvedValue(null);
      await expect(service.delete('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('audience group validation', () => {
    it('rejects an audienceGroupId on a non-MEMBERS form', async () => {
      await expect(
        service.create({
          title: 'Public Signup',
          visibility: FormVisibility.PUBLIC,
          audienceGroupId: 'group-1',
          fields: [{ label: 'Name', fieldType: FormFieldType.TEXT }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts an audienceGroupId on a MEMBERS form', async () => {
      await expect(
        service.create({
          title: 'HODs Only',
          visibility: FormVisibility.MEMBERS,
          audienceGroupId: 'group-1',
          fields: [{ label: 'Name', fieldType: FormFieldType.TEXT }],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('option metadata validation', () => {
    it("rejects a metadata key that is not one of the field's options", async () => {
      await expect(
        service.create({
          title: 'Volunteer Sign-up',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Team',
              fieldType: FormFieldType.DROPDOWN,
              options: ['Choir'],
              optionMetadata: { Ushering: { url: 'https://example.com' } },
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid URL', async () => {
      await expect(
        service.create({
          title: 'Volunteer Sign-up',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Team',
              fieldType: FormFieldType.DROPDOWN,
              options: ['Choir'],
              optionMetadata: { Choir: { url: 'not-a-url' } },
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid option metadata map', async () => {
      await expect(
        service.create({
          title: 'Volunteer Sign-up',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Team',
              fieldType: FormFieldType.DROPDOWN,
              options: ['Choir'],
              optionMetadata: {
                Choir: { url: 'https://example.com', description: 'Sing!' },
              },
            },
          ],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('general action validation', () => {
    it('rejects a generalActionUrl with no label', async () => {
      await expect(
        service.create({
          title: 'Volunteer Sign-up',
          visibility: FormVisibility.PUBLIC,
          generalActionUrl: 'https://example.com/main-group',
          fields: [{ label: 'Name', fieldType: FormFieldType.TEXT }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a generalActionLabel with no url', async () => {
      await expect(
        service.create({
          title: 'Volunteer Sign-up',
          visibility: FormVisibility.PUBLIC,
          generalActionLabel: 'Join Main Group',
          fields: [{ label: 'Name', fieldType: FormFieldType.TEXT }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid general action URL', async () => {
      await expect(
        service.create({
          title: 'Volunteer Sign-up',
          visibility: FormVisibility.PUBLIC,
          generalActionUrl: 'not-a-url',
          generalActionLabel: 'Join Main Group',
          fields: [{ label: 'Name', fieldType: FormFieldType.TEXT }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts both url and label set together', async () => {
      await expect(
        service.create({
          title: 'Volunteer Sign-up',
          visibility: FormVisibility.PUBLIC,
          generalActionUrl: 'https://example.com/main-group',
          generalActionLabel: 'Join Main Group',
          fields: [{ label: 'Name', fieldType: FormFieldType.TEXT }],
        }),
      ).resolves.toBeDefined();
    });

    it('accepts neither being set', async () => {
      await expect(
        service.create({
          title: 'Volunteer Sign-up',
          visibility: FormVisibility.PUBLIC,
          fields: [{ label: 'Name', fieldType: FormFieldType.TEXT }],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('dedup/next-steps field wiring', () => {
    it('sets dedupField to a field already on the form', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [{ id: 'f1', label: 'Phone', fieldType: FormFieldType.PHONE }],
        dedupField: null,
        nextStepsField: null,
      });

      const result = await service.update('form-1', { dedupFieldId: 'f1' });

      expect(result.dedupField).toEqual(expect.objectContaining({ id: 'f1' }));
    });

    it('rejects a dedupFieldId that does not match any field', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [{ id: 'f1', label: 'Phone', fieldType: FormFieldType.PHONE }],
        dedupField: null,
        nextStepsField: null,
      });

      await expect(
        service.update('form-1', { dedupFieldId: 'unknown-id' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a nextStepsFieldId pointing at a non-DROPDOWN field', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [{ id: 'f1', label: 'Name', fieldType: FormFieldType.TEXT }],
        dedupField: null,
        nextStepsField: null,
      });

      await expect(
        service.update('form-1', { nextStepsFieldId: 'f1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a nextStepsFieldId pointing at a DROPDOWN field', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [
          {
            id: 'f1',
            label: 'Team',
            fieldType: FormFieldType.DROPDOWN,
            options: ['Choir'],
          },
        ],
        dedupField: null,
        nextStepsField: null,
      });

      const result = await service.update('form-1', {
        nextStepsFieldId: 'f1',
      });

      expect(result.nextStepsField).toEqual(
        expect.objectContaining({ id: 'f1' }),
      );
    });

    it('clears a stale dedupField reference when that field is removed in the same update', async () => {
      const dedupField = {
        id: 'f1',
        label: 'Phone',
        fieldType: FormFieldType.PHONE,
      } as FormField;
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [dedupField],
        dedupField,
        nextStepsField: null,
      });

      await service.update('form-1', {
        fields: [{ label: 'Replacement Field', fieldType: FormFieldType.TEXT }],
      });

      expect(mockFieldRepo.remove).toHaveBeenCalledWith([dedupField]);
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ dedupField: null }),
      );
    });
  });
});
