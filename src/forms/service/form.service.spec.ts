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
  FormFieldVisibilityOperator,
  FormPurpose,
  FormVisibility,
} from '../enum/form.enum';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { DateService } from '../../utility/service/date.service';
import { FormFieldDto } from '../dto/form.dto';

const mockFormRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'form-1', ...v })),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
  find: jest.fn(),
  findAndCount: jest.fn(),
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
  createQueryBuilder: jest.fn(),
};

// Mirrors GameService.spec's own helper — a chainable query-builder stub,
// empty-by-default so a test that doesn't care about the result still gets
// a safe, valid response; one that does care overrides with its own
// mockResolvedValue on getManyAndCount.
function makeSubmissionQueryBuilderMock() {
  const builder: {
    leftJoinAndSelect: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getManyAndCount: jest.Mock;
  } = {
    leftJoinAndSelect: jest.fn(() => builder),
    where: jest.fn(() => builder),
    orderBy: jest.fn(() => builder),
    addOrderBy: jest.fn(() => builder),
    skip: jest.fn(() => builder),
    take: jest.fn(() => builder),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  };
  return builder;
}
const mockCloudinaryService = {
  uploadBuffer: jest.fn(),
  deleteByPublicId: jest.fn(),
};
const mockDateService = {
  toChurchInstant: jest.fn((value: string) => new Date(value)),
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
        { provide: DateService, useValue: mockDateService },
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

    it('defaults notifyOnSubmission to false when omitted', async () => {
      await service.create({
        title: 'Volunteer Sign-up',
        visibility: FormVisibility.MEMBERS,
        fields: [{ label: 'Name', fieldType: FormFieldType.TEXT }],
      });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ notifyOnSubmission: false }),
      );
    });

    it('sets notifyOnSubmission when explicitly requested', async () => {
      await service.create({
        title: 'Volunteer Sign-up',
        visibility: FormVisibility.MEMBERS,
        notifyOnSubmission: true,
        fields: [{ label: 'Name', fieldType: FormFieldType.TEXT }],
      });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ notifyOnSubmission: true }),
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

  describe('VOTE/QUIZ purpose config validation', () => {
    it('rejects a VOTE form that is not MEMBERS visibility', async () => {
      await expect(
        service.create({
          title: 'Board Election',
          visibility: FormVisibility.PUBLIC,
          purpose: FormPurpose.VOTE,
          fields: [
            {
              label: 'Choice',
              fieldType: FormFieldType.DROPDOWN,
              options: ['A', 'B'],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a VOTE field with a duplicate option value', async () => {
      await expect(
        service.create({
          title: 'Board Election',
          visibility: FormVisibility.MEMBERS,
          purpose: FormPurpose.VOTE,
          fields: [
            {
              label: 'Choice',
              fieldType: FormFieldType.DROPDOWN,
              options: ['Candidate A', 'candidate a'],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a VOTE field that is not Dropdown/Checkbox', async () => {
      await expect(
        service.create({
          title: 'Board Election',
          visibility: FormVisibility.MEMBERS,
          purpose: FormPurpose.VOTE,
          fields: [
            { label: 'Your Name', fieldType: FormFieldType.TEXT },
            {
              label: 'Choice',
              fieldType: FormFieldType.DROPDOWN,
              options: ['Candidate A', 'Candidate B'],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid MEMBERS-visibility VOTE with unique options', async () => {
      const result = await service.create({
        title: 'Board Election',
        visibility: FormVisibility.MEMBERS,
        purpose: FormPurpose.VOTE,
        oneResponsePerMember: true,
        fields: [
          {
            label: 'Choice',
            fieldType: FormFieldType.DROPDOWN,
            options: ['Candidate A', 'Candidate B'],
          },
        ],
      });
      expect(result.title).toBe('Board Election');
    });

    it('rejects a QUIZ correctOptions value that is not one of the field options', async () => {
      await expect(
        service.create({
          title: 'Chapter 1 Quiz',
          visibility: FormVisibility.MEMBERS,
          purpose: FormPurpose.QUIZ,
          fields: [
            {
              label: 'Capital of France?',
              fieldType: FormFieldType.DROPDOWN,
              options: ['Paris', 'London'],
              correctOptions: ['Berlin'],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects correctOptions on a non-choice field type', async () => {
      await expect(
        service.create({
          title: 'Chapter 1 Quiz',
          visibility: FormVisibility.MEMBERS,
          purpose: FormPurpose.QUIZ,
          fields: [
            {
              label: 'Your thoughts?',
              fieldType: FormFieldType.TEXT,
              correctOptions: ['Anything'],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a timed QUIZ that is not MEMBERS visibility', async () => {
      await expect(
        service.create({
          title: 'Public Trivia',
          visibility: FormVisibility.PUBLIC,
          purpose: FormPurpose.QUIZ,
          timeLimitMinutes: 10,
          fields: [
            {
              label: 'Q1',
              fieldType: FormFieldType.DROPDOWN,
              options: ['A', 'B'],
              correctOptions: ['A'],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid MEMBERS-visibility timed QUIZ', async () => {
      const result = await service.create({
        title: 'Timed Quiz',
        visibility: FormVisibility.MEMBERS,
        purpose: FormPurpose.QUIZ,
        timeLimitMinutes: 10,
        fields: [
          {
            label: 'Q1',
            fieldType: FormFieldType.DROPDOWN,
            options: ['A', 'B'],
            correctOptions: ['A'],
          },
        ],
      });
      expect(result.title).toBe('Timed Quiz');
    });

    it('rejects a QUIZ field that is not Dropdown/Checkbox/Text/Long Text', async () => {
      await expect(
        service.create({
          title: 'Chapter 1 Quiz',
          visibility: FormVisibility.MEMBERS,
          purpose: FormPurpose.QUIZ,
          fields: [
            {
              label: 'Your Email',
              fieldType: FormFieldType.EMAIL,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a QUIZ mixing a graded Dropdown question with an ungraded short-answer Text field', async () => {
      const result = await service.create({
        title: 'Chapter 1 Quiz',
        visibility: FormVisibility.MEMBERS,
        purpose: FormPurpose.QUIZ,
        fields: [
          {
            label: 'Capital of France?',
            fieldType: FormFieldType.DROPDOWN,
            options: ['Paris', 'London'],
            correctOptions: ['Paris'],
          },
          {
            label: 'Explain your reasoning',
            fieldType: FormFieldType.TEXTAREA,
          },
        ],
      });
      expect(result.title).toBe('Chapter 1 Quiz');
    });

    it('rejects closesAt on or before opensAt', async () => {
      await expect(
        service.create({
          title: 'Timed Vote',
          visibility: FormVisibility.MEMBERS,
          purpose: FormPurpose.VOTE,
          opensAt: '2026-03-05T17:00:00',
          closesAt: '2026-03-05T16:00:00',
          fields: [
            {
              label: 'Choice',
              fieldType: FormFieldType.DROPDOWN,
              options: ['A', 'B'],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('defaults purpose to STANDARD and persists it on the entity', async () => {
      await service.create({
        title: 'Plain Form',
        visibility: FormVisibility.MEMBERS,
        fields: [{ label: 'Name', fieldType: FormFieldType.TEXT }],
      });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: FormPurpose.STANDARD }),
      );
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

    it('updates notifyOnSubmission when explicitly set', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Old Title',
        notifyOnSubmission: false,
        fields: [],
      });

      await service.update('form-1', { notifyOnSubmission: true });

      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ notifyOnSubmission: true }),
      );
    });

    it('leaves notifyOnSubmission untouched when omitted', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Old Title',
        notifyOnSubmission: true,
        fields: [],
      });

      await service.update('form-1', { title: 'New Title' });

      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ notifyOnSubmission: true }),
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

    it('emits the URL for a FILE answer instead of stringifying the object', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        fields: [
          { id: 'f1', label: 'Proof', order: 0, fieldType: FormFieldType.FILE },
        ],
      });
      mockSubmissionRepo.find.mockResolvedValue([
        {
          createdAt: new Date('2026-01-01T00:00:00Z'),
          member: null,
          answers: {
            f1: { url: 'https://cdn.example.com/f.pdf', publicId: 'x' },
          },
        },
      ]);

      const csv = await service.getSubmissionsCsv('form-1');

      expect(csv).toContain('"https://cdn.example.com/f.pdf"');
      expect(csv).not.toContain('[object Object]');
    });

    it('emits an empty cell for an unanswered FILE field', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        fields: [
          { id: 'f1', label: 'Proof', order: 0, fieldType: FormFieldType.FILE },
        ],
      });
      mockSubmissionRepo.find.mockResolvedValue([
        {
          createdAt: new Date('2026-01-01T00:00:00Z'),
          member: null,
          answers: {},
        },
      ]);

      const csv = await service.getSubmissionsCsv('form-1');
      const rows = csv.split('\n');
      expect(rows[1]).toBe('"2026-01-01T00:00:00.000Z","Public",""');
    });
  });

  describe('getAnalytics', () => {
    it('sorts choices by count descending, leading option first, ties keeping declared order', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Elder Election',
        purpose: FormPurpose.VOTE,
        fields: [
          {
            id: 'f1',
            label: 'Candidate',
            fieldType: FormFieldType.DROPDOWN,
            options: ['Candidate A', 'Candidate B', 'Candidate C'],
            order: 0,
          },
        ],
      });
      mockSubmissionRepo.find.mockResolvedValue([
        { answers: { f1: 'Candidate C' } },
        { answers: { f1: 'Candidate B' } },
        { answers: { f1: 'Candidate C' } },
        { answers: { f1: 'Candidate A' } },
      ]);

      const result = await service.getAnalytics('form-1');

      expect(result.fields[0].choices).toEqual([
        { option: 'Candidate C', count: 2, percentage: 50 },
        { option: 'Candidate A', count: 1, percentage: 25 },
        { option: 'Candidate B', count: 1, percentage: 25 },
      ]);
    });

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

    it('reports an upload count for FILE fields instead of sample answers', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Application',
        fields: [
          {
            id: 'f1',
            label: 'Resume',
            fieldType: FormFieldType.FILE,
            order: 0,
          },
        ],
      });
      mockSubmissionRepo.find.mockResolvedValue([
        {
          answers: {
            f1: { url: 'https://cdn.example.com/a.pdf', publicId: 'a' },
          },
        },
        {
          answers: {
            f1: { url: 'https://cdn.example.com/b.pdf', publicId: 'b' },
          },
        },
        { answers: {} },
      ]);

      const result = await service.getAnalytics('form-1');

      expect(result.fields[0].uploadCount).toBe(2);
      expect(result.fields[0].sampleAnswers).toBeUndefined();
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

  describe('field constraints validation', () => {
    it('accepts minValue/maxValue on a NUMBER field', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Age',
              fieldType: FormFieldType.NUMBER,
              minValue: 18,
              maxValue: 100,
            },
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('rejects minValue/maxValue set on a non-NUMBER field', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            { label: 'Name', fieldType: FormFieldType.TEXT, minValue: 1 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // Regression: the admin field editor sends an explicit `null` (not
    // omitted) for every bound that doesn't apply to a newly-selected
    // fieldType — e.g. switching a field to PHONE sends
    // { minValue: null, maxValue: null, minLength: null, maxLength: null,
    // minSelections: null, maxSelections: null, validationRegex: null,
    // validationMessage: null }. A guard that only special-cased `undefined`
    // (not `null`) rejected this on every single save with "minValue/
    // maxValue only apply to NUMBER fields", even though nothing was ever
    // actually configured.
    it('accepts explicit null minValue/maxValue/minLength/maxLength/minSelections/maxSelections/validationRegex on a PHONE field', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Phone Number',
              fieldType: FormFieldType.PHONE,
              minValue: null,
              maxValue: null,
              minLength: null,
              maxLength: null,
              minSelections: null,
              maxSelections: null,
              validationRegex: null,
              validationMessage: null,
            } as unknown as FormFieldDto,
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('rejects maxValue less than minValue', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Age',
              fieldType: FormFieldType.NUMBER,
              minValue: 100,
              maxValue: 18,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts minLength/maxLength on TEXT and TEXTAREA fields', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Bio',
              fieldType: FormFieldType.TEXTAREA,
              minLength: 10,
              maxLength: 500,
            },
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('rejects minLength/maxLength set on a DROPDOWN field', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Team',
              fieldType: FormFieldType.DROPDOWN,
              options: ['Choir'],
              maxLength: 10,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects maxLength less than minLength', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Bio',
              fieldType: FormFieldType.TEXT,
              minLength: 500,
              maxLength: 10,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts minSelections/maxSelections on a CHECKBOX field', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Interests',
              fieldType: FormFieldType.CHECKBOX,
              options: ['Choir', 'Ushering'],
              minSelections: 1,
              maxSelections: 2,
            },
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('rejects minSelections/maxSelections set on a non-CHECKBOX field', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Team',
              fieldType: FormFieldType.DROPDOWN,
              options: ['Choir'],
              minSelections: 1,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects maxSelections less than minSelections', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Interests',
              fieldType: FormFieldType.CHECKBOX,
              options: ['Choir', 'Ushering'],
              minSelections: 2,
              maxSelections: 1,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a bound equal to its counterpart (max === min)', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Age',
              fieldType: FormFieldType.NUMBER,
              minValue: 18,
              maxValue: 18,
            },
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('accepts only one side of a bound pair set', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            { label: 'Age', fieldType: FormFieldType.NUMBER, minValue: 18 },
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('validates constraints on update too', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [],
      });
      await expect(
        service.update('form-1', {
          fields: [
            { label: 'Name', fieldType: FormFieldType.TEXT, minValue: 1 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // Regression: this is the actual real-world trigger — the admin field
    // editor's fieldType <select> onChange sends explicit `null` (not
    // omitted) for every bound that doesn't apply to whatever type is newly
    // picked. Saving a PHONE field (or any non-NUMBER type) through the
    // normal "choose a type from the dropdown, then Save" flow must not
    // 400.
    it('accepts explicit null bounds on update, not just create', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [],
      });
      await expect(
        service.update('form-1', {
          fields: [
            {
              label: 'Phone Number',
              fieldType: FormFieldType.PHONE,
              minValue: null,
              maxValue: null,
              minLength: null,
              maxLength: null,
              minSelections: null,
              maxSelections: null,
            } as unknown as FormFieldDto,
          ],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('validationRegex validation', () => {
    it('accepts a valid regex on a TEXT field', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'NIN',
              fieldType: FormFieldType.TEXT,
              validationRegex: '^\\d{11}$',
              validationMessage: 'Must be an 11-digit NIN',
            },
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('accepts a valid regex on a TEXTAREA field', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Bio',
              fieldType: FormFieldType.TEXTAREA,
              validationRegex: '^[A-Za-z ]+$',
            },
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('rejects validationRegex set on a non-TEXT/TEXTAREA field', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Age',
              fieldType: FormFieldType.NUMBER,
              validationRegex: '^\\d+$',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a syntactically invalid regex', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Name',
              fieldType: FormFieldType.TEXT,
              validationRegex: '(unclosed',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('validates the pattern on update too', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [],
      });
      await expect(
        service.update('form-1', {
          fields: [
            {
              label: 'Age',
              fieldType: FormFieldType.NUMBER,
              validationRegex: '^\\d+$',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // Regression, same root cause as the field-constraints one above — the
    // field editor sends validationRegex: null (not omitted) whenever a
    // field is switched away from TEXT/TEXTAREA.
    it('accepts an explicit null validationRegex on a non-TEXT field', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            {
              label: 'Phone Number',
              fieldType: FormFieldType.PHONE,
              validationRegex: null,
              validationMessage: null,
            } as unknown as FormFieldDto,
          ],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('visibilityRule validation', () => {
    it('rejects a visibilityRule on create, since no field has an id yet', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [
            { label: 'Team', fieldType: FormFieldType.TEXT },
            {
              label: 'Team Lead',
              fieldType: FormFieldType.TEXT,
              visibilityRule: {
                fieldId: 'some-id',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: 'Choir',
              },
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a visibilityRule on update referencing an existing field', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      await expect(
        service.update('form-1', {
          fields: [
            { id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT },
            {
              label: 'Team Lead',
              fieldType: FormFieldType.TEXT,
              visibilityRule: {
                fieldId: 'f1',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: 'Choir',
              },
            },
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('rejects a visibilityRule referencing an unknown field id', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      await expect(
        service.update('form-1', {
          fields: [
            { id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT },
            {
              label: 'Team Lead',
              fieldType: FormFieldType.TEXT,
              visibilityRule: {
                fieldId: 'unknown-id',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: 'Choir',
              },
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a field whose visibilityRule references itself', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      await expect(
        service.update('form-1', {
          fields: [
            {
              id: 'f1',
              label: 'Team',
              fieldType: FormFieldType.TEXT,
              visibilityRule: {
                fieldId: 'f1',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: 'x',
              },
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a visibilityRule value that isn't one of the trigger DROPDOWN field's options", async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [
          {
            id: 'f1',
            label: 'Team',
            fieldType: FormFieldType.DROPDOWN,
            options: ['Choir', 'Ushering'],
          },
        ],
      });
      await expect(
        service.update('form-1', {
          fields: [
            {
              id: 'f1',
              label: 'Team',
              fieldType: FormFieldType.DROPDOWN,
              options: ['Choir', 'Ushering'],
            },
            {
              label: 'Team Lead',
              fieldType: FormFieldType.TEXT,
              visibilityRule: {
                fieldId: 'f1',
                operator: FormFieldVisibilityOperator.EQUALS,
                // Typo/case mismatch against the trigger's real option
                // ("Choir") — this must be caught here rather than silently
                // never matching a real submission.
                value: 'choir',
              },
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("accepts a visibilityRule value that matches one of the trigger DROPDOWN field's options", async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [
          {
            id: 'f1',
            label: 'Team',
            fieldType: FormFieldType.DROPDOWN,
            options: ['Choir', 'Ushering'],
          },
        ],
      });
      await expect(
        service.update('form-1', {
          fields: [
            {
              id: 'f1',
              label: 'Team',
              fieldType: FormFieldType.DROPDOWN,
              options: ['Choir', 'Ushering'],
            },
            {
              label: 'Team Lead',
              fieldType: FormFieldType.TEXT,
              visibilityRule: {
                fieldId: 'f1',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: 'Choir',
              },
            },
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('does not require the value to match any option when the trigger field has no fixed option set (free text)', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [{ id: 'f1', label: 'Age', fieldType: FormFieldType.NUMBER }],
      });
      await expect(
        service.update('form-1', {
          fields: [
            { id: 'f1', label: 'Age', fieldType: FormFieldType.NUMBER },
            {
              label: 'Guardian Name',
              fieldType: FormFieldType.TEXT,
              visibilityRule: {
                fieldId: 'f1',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: '17',
              },
            },
          ],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('postSubmitOutcomes validation', () => {
    it('rejects a postSubmitOutcome on create, since no field has an id yet', async () => {
      await expect(
        service.create({
          title: 'Signup',
          visibility: FormVisibility.PUBLIC,
          fields: [{ label: 'Team', fieldType: FormFieldType.TEXT }],
          postSubmitOutcomes: [
            {
              conditions: [
                {
                  fieldId: 'some-id',
                  operator: FormFieldVisibilityOperator.EQUALS,
                  value: 'Choir',
                },
              ],
              message: 'Welcome to Choir!',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a postSubmitOutcome on update referencing an existing field', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      await expect(
        service.update('form-1', {
          postSubmitOutcomes: [
            {
              conditions: [
                {
                  fieldId: 'f1',
                  operator: FormFieldVisibilityOperator.EQUALS,
                  value: 'Choir',
                },
              ],
              message: 'Welcome to Choir!',
              actionUrl: 'https://chat.whatsapp.com/choir',
              actionLabel: 'Join Choir Group',
            },
          ],
        }),
      ).resolves.toBeDefined();
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          postSubmitOutcomes: [
            expect.objectContaining({ message: 'Welcome to Choir!' }),
          ],
        }),
      );
    });

    it('rejects a condition referencing an unknown field id', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      await expect(
        service.update('form-1', {
          postSubmitOutcomes: [
            {
              conditions: [
                {
                  fieldId: 'unknown-id',
                  operator: FormFieldVisibilityOperator.EQUALS,
                  value: 'Choir',
                },
              ],
              message: 'Welcome!',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an outcome with actionUrl but no actionLabel', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      await expect(
        service.update('form-1', {
          postSubmitOutcomes: [
            {
              conditions: [
                {
                  fieldId: 'f1',
                  operator: FormFieldVisibilityOperator.EQUALS,
                  value: 'Choir',
                },
              ],
              actionUrl: 'https://chat.whatsapp.com/choir',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts an outcome with actionUrl but no actionLabel when hideAction is set — the pairing check does not apply to a hidden action', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      await expect(
        service.update('form-1', {
          postSubmitOutcomes: [
            {
              conditions: [
                {
                  fieldId: 'f1',
                  operator: FormFieldVisibilityOperator.EQUALS,
                  value: 'Choir',
                },
              ],
              actionUrl: 'https://chat.whatsapp.com/choir',
              hideAction: true,
            },
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('forces message/actionUrl/actionLabel to null when hideMessage/hideAction are set, regardless of any stray value sent', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      await service.update('form-1', {
        postSubmitOutcomes: [
          {
            conditions: [
              {
                fieldId: 'f1',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: 'Choir',
              },
            ],
            message: 'stray message',
            hideMessage: true,
            actionUrl: 'https://chat.whatsapp.com/choir',
            actionLabel: 'stray label',
            hideAction: true,
          },
        ],
      });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          postSubmitOutcomes: [
            expect.objectContaining({
              message: null,
              hideMessage: true,
              actionUrl: null,
              actionLabel: null,
              hideAction: true,
            }),
          ],
        }),
      );
    });

    it('defaults hideMessage/hideAction to false when omitted', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      await service.update('form-1', {
        postSubmitOutcomes: [
          {
            conditions: [
              {
                fieldId: 'f1',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: 'Choir',
              },
            ],
            message: 'Welcome!',
          },
        ],
      });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          postSubmitOutcomes: [
            expect.objectContaining({ hideMessage: false, hideAction: false }),
          ],
        }),
      );
    });

    it('validates against the current form fields when the update omits `fields`', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      await expect(
        service.update('form-1', {
          postSubmitOutcomes: [
            {
              conditions: [
                {
                  fieldId: 'unknown-id',
                  operator: FormFieldVisibilityOperator.EQUALS,
                  value: 'Choir',
                },
              ],
              message: 'Welcome!',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears postSubmitOutcomes with an explicit empty array', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        postSubmitOutcomes: [
          {
            conditions: [
              {
                fieldId: 'f1',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: 'Choir',
              },
            ],
            message: 'Welcome!',
            actionUrl: null,
            actionLabel: null,
          },
        ],
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      await service.update('form-1', { postSubmitOutcomes: [] });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ postSubmitOutcomes: [] }),
      );
    });

    it('leaves postSubmitOutcomes untouched when omitted on update', async () => {
      const existingOutcomes = [
        {
          conditions: [
            {
              fieldId: 'f1',
              operator: FormFieldVisibilityOperator.EQUALS,
              value: 'Choir',
            },
          ],
          message: 'Welcome!',
          actionUrl: null,
          actionLabel: null,
        },
      ];
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Old Title',
        visibility: FormVisibility.PUBLIC,
        postSubmitOutcomes: existingOutcomes,
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      await service.update('form-1', { title: 'New Title' });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ postSubmitOutcomes: existingOutcomes }),
      );
    });

    it('re-matches an outcome condition to the cloned target field by label', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        postSubmitOutcomes: [
          {
            conditions: [
              {
                fieldId: 'f1',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: 'Choir',
              },
            ],
            message: 'Welcome to Choir!',
            actionUrl: null,
            actionLabel: null,
          },
        ],
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      mockFieldRepo.save.mockResolvedValueOnce([
        { id: 'cloned-0', label: 'Team', fieldType: FormFieldType.TEXT },
      ]);
      const result = await service.cloneForm('form-1', { title: 'Copy' });
      expect(result.postSubmitOutcomes).toEqual([
        expect.objectContaining({
          message: 'Welcome to Choir!',
          conditions: [expect.objectContaining({ fieldId: 'cloned-0' })],
        }),
      ]);
    });

    it('carries hideMessage/hideAction through the clone remap unchanged', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        postSubmitOutcomes: [
          {
            conditions: [
              {
                fieldId: 'f1',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: 'Choir',
              },
            ],
            message: null,
            hideMessage: true,
            actionUrl: null,
            actionLabel: null,
            hideAction: false,
          },
        ],
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      mockFieldRepo.save.mockResolvedValueOnce([
        { id: 'cloned-0', label: 'Team', fieldType: FormFieldType.TEXT },
      ]);
      const result = await service.cloneForm('form-1', { title: 'Copy' });
      expect(result.postSubmitOutcomes).toEqual([
        expect.objectContaining({
          hideMessage: true,
          hideAction: false,
          conditions: [expect.objectContaining({ fieldId: 'cloned-0' })],
        }),
      ]);
    });

    it("drops a postSubmitOutcome whose condition target didn't survive the clone", async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        visibility: FormVisibility.PUBLIC,
        postSubmitOutcomes: [
          {
            conditions: [
              {
                fieldId: 'missing-id',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: 'Choir',
              },
            ],
            message: 'Welcome to Choir!',
            actionUrl: null,
            actionLabel: null,
          },
        ],
        fields: [{ id: 'f1', label: 'Team', fieldType: FormFieldType.TEXT }],
      });
      mockFieldRepo.save.mockResolvedValueOnce([
        { id: 'cloned-0', label: 'Team', fieldType: FormFieldType.TEXT },
      ]);
      const result = await service.cloneForm('form-1', { title: 'Copy' });
      expect(result.postSubmitOutcomes).toBeNull();
    });
  });

  describe('editableAfterSubmit', () => {
    it('defaults to true on create when omitted', async () => {
      await service.create({
        title: 'Volunteer Sign-up',
        visibility: FormVisibility.PUBLIC,
        fields: [{ label: 'Name', fieldType: FormFieldType.TEXT }],
      });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ editableAfterSubmit: true }),
      );
    });

    it('can be set to false on create', async () => {
      await service.create({
        title: 'Consent Form',
        visibility: FormVisibility.PUBLIC,
        editableAfterSubmit: false,
        fields: [{ label: 'Name', fieldType: FormFieldType.TEXT }],
      });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ editableAfterSubmit: false }),
      );
    });

    it('updates editableAfterSubmit when explicitly set', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Old Title',
        editableAfterSubmit: true,
        fields: [],
      });
      await service.update('form-1', { editableAfterSubmit: false });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ editableAfterSubmit: false }),
      );
    });

    it('leaves editableAfterSubmit untouched when omitted on update', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Old Title',
        editableAfterSubmit: false,
        fields: [],
      });
      await service.update('form-1', { title: 'New Title' });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ editableAfterSubmit: false }),
      );
    });

    it('inherits editableAfterSubmit from the source on clone when omitted', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Consent Form',
        visibility: FormVisibility.PUBLIC,
        editableAfterSubmit: false,
        fields: [{ id: 'f1', label: 'Name', fieldType: FormFieldType.TEXT }],
      });
      mockFieldRepo.save.mockResolvedValueOnce([
        { id: 'cloned-0', label: 'Name', fieldType: FormFieldType.TEXT },
      ]);
      await service.cloneForm('form-1', { title: 'Copy' });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ editableAfterSubmit: false }),
      );
    });

    it('forces editableAfterSubmit to false on create for a QUIZ, even when true is requested', async () => {
      await service.create({
        title: 'Chapter 3 Test',
        visibility: FormVisibility.PUBLIC,
        purpose: FormPurpose.QUIZ,
        editableAfterSubmit: true,
        fields: [
          {
            label: 'Capital of France',
            fieldType: FormFieldType.DROPDOWN,
            options: ['Paris', 'Lyon'],
            correctOptions: ['Paris'],
          },
        ],
      });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ editableAfterSubmit: false }),
      );
    });

    it('forces editableAfterSubmit to false on update for a QUIZ, even when true is requested', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Chapter 3 Test',
        purpose: FormPurpose.QUIZ,
        editableAfterSubmit: false,
        fields: [],
      });
      await service.update('form-1', { editableAfterSubmit: true });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ editableAfterSubmit: false }),
      );
    });

    it('forces editableAfterSubmit to false on clone for a QUIZ, even when the source or dto allows edits', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Chapter 3 Test',
        visibility: FormVisibility.PUBLIC,
        purpose: FormPurpose.QUIZ,
        editableAfterSubmit: true,
        fields: [{ id: 'f1', label: 'Q1', fieldType: FormFieldType.DROPDOWN }],
      });
      mockFieldRepo.save.mockResolvedValueOnce([
        { id: 'cloned-0', label: 'Q1', fieldType: FormFieldType.DROPDOWN },
      ]);
      await service.cloneForm('form-1', {
        title: 'Copy',
        editableAfterSubmit: true,
      });
      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ editableAfterSubmit: false }),
      );
    });
  });

  describe('multi-page (pageIndex)', () => {
    it('defaults pageIndex to 0 when omitted', async () => {
      await service.create({
        title: 'Volunteer Sign-up',
        visibility: FormVisibility.PUBLIC,
        fields: [{ label: 'Name', fieldType: FormFieldType.TEXT }],
      });
      expect(mockFieldRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ pageIndex: 0 })]),
      );
    });

    it('persists an explicit pageIndex per field', async () => {
      await service.create({
        title: 'Volunteer Sign-up',
        visibility: FormVisibility.PUBLIC,
        fields: [
          { label: 'Name', fieldType: FormFieldType.TEXT, pageIndex: 0 },
          { label: 'Team', fieldType: FormFieldType.TEXT, pageIndex: 1 },
        ],
      });
      expect(mockFieldRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ label: 'Name', pageIndex: 0 }),
        expect.objectContaining({ label: 'Team', pageIndex: 1 }),
      ]);
    });

    it('carries pageIndex through on update', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        title: 'Old Title',
        fields: [],
      });
      await service.update('form-1', {
        fields: [
          { label: 'Name', fieldType: FormFieldType.TEXT, pageIndex: 2 },
        ],
      });
      expect(mockFieldRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ pageIndex: 2 }),
      ]);
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

  describe('cloneForm', () => {
    // mockFieldRepo.save/create just echo their input in every other test —
    // the real DB assigns each cloned field a fresh id, which
    // matchClonedFieldByLabel depends on, so this test's own save mock
    // stamps predictable ids on the cloned array.
    function mockFieldSaveWithFreshIds() {
      mockFieldRepo.save.mockImplementationOnce((fields: FormField[]) =>
        Promise.resolve(
          fields.map((f, i) => ({ ...f, id: `cloned-${i}` }) as FormField),
        ),
      );
    }

    const sourceForm = {
      id: 'form-1',
      title: 'Volunteer Sign-up',
      description: 'Original description',
      visibility: FormVisibility.MEMBERS,
      isActive: true,
      event: { id: 'event-1' },
      createsFirstTimers: false,
      notifyOnSubmission: true,
      audienceGroup: { id: 'group-1' },
      dedupField: null,
      nextStepsField: null,
      postSubmitMessage: 'Thanks!',
      generalActionUrl: 'https://example.com/group',
      generalActionLabel: 'Join Group',
      coverImageUrl: 'https://cdn.example.com/cover.jpg',
      coverImagePublicId: 'form-covers/abc',
      logoUrl: 'https://cdn.example.com/logo.jpg',
      logoPublicId: 'form-logos/abc',
      fields: [
        {
          id: 'f1',
          label: 'Name',
          fieldType: FormFieldType.TEXT,
          required: true,
        },
      ],
    } as unknown as Form;

    it('throws NotFoundException for an unknown source form', async () => {
      mockFormRepo.findOne.mockResolvedValue(null);
      await expect(
        service.cloneForm('missing', { title: 'Copy' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('inherits scalars from the source when the dto only sets title', async () => {
      mockFormRepo.findOne.mockResolvedValue(sourceForm);
      mockFieldSaveWithFreshIds();

      await service.cloneForm('form-1', { title: 'Volunteer Sign-up (Copy)' });

      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Volunteer Sign-up (Copy)',
          description: 'Original description',
          visibility: FormVisibility.MEMBERS,
          isActive: false,
          notifyOnSubmission: true,
          postSubmitMessage: 'Thanks!',
          generalActionUrl: 'https://example.com/group',
          generalActionLabel: 'Join Group',
          audienceGroup: { id: 'group-1' },
        }),
      );
    });

    it('never carries over cover/logo branding', async () => {
      mockFormRepo.findOne.mockResolvedValue(sourceForm);
      mockFieldSaveWithFreshIds();

      await service.cloneForm('form-1', { title: 'Copy' });

      const created = mockFormRepo.save.mock.calls[0][0];
      expect(created).not.toHaveProperty('coverImageUrl');
      expect(created).not.toHaveProperty('coverImagePublicId');
      expect(created).not.toHaveProperty('logoUrl');
      expect(created).not.toHaveProperty('logoPublicId');
    });

    it('overrides a scalar explicitly passed in the dto', async () => {
      mockFormRepo.findOne.mockResolvedValue(sourceForm);
      mockFieldSaveWithFreshIds();

      await service.cloneForm('form-1', {
        title: 'Copy',
        postSubmitMessage: 'New thank-you message',
      });

      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ postSubmitMessage: 'New thank-you message' }),
      );
    });

    it('carries each field pageIndex through to the clone', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...sourceForm,
        fields: [{ ...sourceForm.fields[0], pageIndex: 1 }],
      });
      mockFieldSaveWithFreshIds();

      await service.cloneForm('form-1', { title: 'Copy' });

      expect(mockFieldRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ pageIndex: 1 }),
      ]);
    });

    it('re-matches a visibilityRule to the cloned target field by label', async () => {
      const teamField = {
        id: 'f1',
        label: 'Team',
        fieldType: FormFieldType.TEXT,
      };
      const leadField = {
        id: 'f2',
        label: 'Team Lead',
        fieldType: FormFieldType.TEXT,
        visibilityRule: {
          fieldId: 'f1',
          operator: FormFieldVisibilityOperator.EQUALS,
          value: 'Choir',
        },
      };
      mockFormRepo.findOne.mockResolvedValue({
        ...sourceForm,
        fields: [teamField, leadField],
      });
      mockFieldSaveWithFreshIds();

      await service.cloneForm('form-1', { title: 'Copy' });

      // First save() call clones both fields (visibilityRule cleared);
      // second is the remap pass, patching the cloned "Team Lead" to
      // point at the cloned "Team"'s fresh id.
      expect(mockFieldRepo.save).toHaveBeenNthCalledWith(2, [
        expect.objectContaining({
          id: 'cloned-1',
          visibilityRule: expect.objectContaining({ fieldId: 'cloned-0' }),
        }),
      ]);
    });

    it('drops a visibilityRule whose target field no longer exists after clone rather than leaving it dangling', async () => {
      const leadField = {
        id: 'f2',
        label: 'Team Lead',
        fieldType: FormFieldType.TEXT,
        visibilityRule: {
          fieldId: 'missing-source-id',
          operator: FormFieldVisibilityOperator.EQUALS,
          value: 'Choir',
        },
      };
      mockFormRepo.findOne.mockResolvedValue({
        ...sourceForm,
        fields: [leadField],
      });
      mockFieldSaveWithFreshIds();

      await service.cloneForm('form-1', { title: 'Copy' });

      // Only the initial clone save() call happens — no second remap
      // save(), since the referenced field never resolves.
      expect(mockFieldRepo.save).toHaveBeenCalledTimes(1);
    });

    it('clears a nullable field via an explicit null override', async () => {
      mockFormRepo.findOne.mockResolvedValue(sourceForm);
      mockFieldSaveWithFreshIds();

      await service.cloneForm('form-1', {
        title: 'Copy',
        audienceGroupId: null,
      });

      expect(mockFormRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ audienceGroup: null }),
      );
    });

    it('clones fields with fresh ids, not the source field ids', async () => {
      mockFormRepo.findOne.mockResolvedValue(sourceForm);
      mockFieldSaveWithFreshIds();

      const result = await service.cloneForm('form-1', { title: 'Copy' });

      expect(result.fields).toEqual([
        expect.objectContaining({ id: 'cloned-0', label: 'Name' }),
      ]);
      expect(mockFieldRepo.save).toHaveBeenCalledWith([
        expect.not.objectContaining({ id: 'f1' }),
      ]);
    });

    it('re-matches dedupField/nextStepsField by label on the cloned fields', async () => {
      const dropdownField = {
        id: 'f2',
        label: 'Team',
        fieldType: FormFieldType.DROPDOWN,
        options: ['Choir'],
      } as FormField;
      mockFormRepo.findOne.mockResolvedValue({
        ...sourceForm,
        dedupField: sourceForm.fields[0],
        nextStepsField: dropdownField,
        fields: [sourceForm.fields[0], dropdownField],
      });
      mockFieldSaveWithFreshIds();

      const result = await service.cloneForm('form-1', { title: 'Copy' });

      expect(result.dedupField).toEqual(
        expect.objectContaining({ id: 'cloned-0', label: 'Name' }),
      );
      expect(result.nextStepsField).toEqual(
        expect.objectContaining({ id: 'cloned-1', label: 'Team' }),
      );
    });

    it('never touches FormSubmission', async () => {
      mockFormRepo.findOne.mockResolvedValue(sourceForm);
      mockFieldSaveWithFreshIds();

      await service.cloneForm('form-1', { title: 'Copy' });

      expect(mockSubmissionRepo.find).not.toHaveBeenCalled();
      expect(mockSubmissionRepo.findAndCount).not.toHaveBeenCalled();
    });

    it('rejects an audienceGroupId override on a form whose resolved visibility is not MEMBERS', async () => {
      mockFormRepo.findOne.mockResolvedValue(sourceForm);
      mockFieldSaveWithFreshIds();

      await expect(
        service.cloneForm('form-1', {
          title: 'Copy',
          visibility: FormVisibility.PUBLIC,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects createsFirstTimers inherited from source once visibility is overridden away from PUBLIC', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...sourceForm,
        visibility: FormVisibility.PUBLIC,
        createsFirstTimers: true,
        audienceGroup: null,
        fields: [
          {
            id: 'f1',
            label: 'First Name',
            fieldType: FormFieldType.TEXT,
            required: true,
            autoFillKey: FormFieldAutoFill.FIRST_NAME,
          },
          {
            id: 'f2',
            label: 'Last Name',
            fieldType: FormFieldType.TEXT,
            required: true,
            autoFillKey: FormFieldAutoFill.LAST_NAME,
          },
          {
            id: 'f3',
            label: 'Phone',
            fieldType: FormFieldType.PHONE,
            required: true,
            autoFillKey: FormFieldAutoFill.PHONE_NUMBER,
          },
        ],
      });
      mockFieldSaveWithFreshIds();

      await expect(
        service.cloneForm('form-1', {
          title: 'Copy',
          visibility: FormVisibility.MEMBERS,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getSubmissions', () => {
    it('sorts by createdAt DESC by default (unpaginated fields untouched)', async () => {
      mockFormRepo.findOne.mockResolvedValue({ id: 'form-1', fields: [] });
      mockSubmissionRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.getSubmissions('form-1');
      expect(mockSubmissionRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'DESC' } }),
      );
      expect(mockSubmissionRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('sorts by score DESC with NULLS LAST when sortBy is score, for a QUIZ leaderboard', async () => {
      mockFormRepo.findOne.mockResolvedValue({ id: 'form-1', fields: [] });
      const qb = makeSubmissionQueryBuilderMock();
      qb.getManyAndCount.mockResolvedValue([
        [
          { id: 'sub-1', score: 8 },
          { id: 'sub-2', score: 3 },
        ],
        2,
      ]);
      mockSubmissionRepo.createQueryBuilder.mockReturnValue(qb);
      const result = await service.getSubmissions('form-1', 1, 20, 'score');
      expect(qb.orderBy).toHaveBeenCalledWith(
        'submission.score',
        'DESC',
        'NULLS LAST',
      );
      expect(qb.addOrderBy).toHaveBeenCalledWith(
        'submission.createdAt',
        'DESC',
      );
      expect(result.data).toEqual([
        { id: 'sub-1', score: 8 },
        { id: 'sub-2', score: 3 },
      ]);
      expect(mockSubmissionRepo.findAndCount).not.toHaveBeenCalled();
    });
  });

  describe('listForms', () => {
    it('paginates with defaults when no filters are given', async () => {
      mockFormRepo.findAndCount.mockResolvedValue([[{ id: 'form-1' }], 1]);
      const result = await service.listForms();
      expect(mockFormRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          skip: 0,
          take: 20,
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          data: [{ id: 'form-1' }],
          page: 1,
          limit: 20,
          totalCount: 1,
          totalPages: 1,
        }),
      );
    });

    it('filters by purpose, visibility, and status exactly', async () => {
      mockFormRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.listForms(
        1,
        20,
        undefined,
        FormPurpose.QUIZ,
        FormVisibility.MEMBERS,
        'ACTIVE',
      );
      expect(mockFormRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            purpose: FormPurpose.QUIZ,
            visibility: FormVisibility.MEMBERS,
            isActive: true,
          },
        }),
      );
    });

    it('maps an INACTIVE status filter to isActive: false', async () => {
      mockFormRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.listForms(
        1,
        20,
        undefined,
        undefined,
        undefined,
        'INACTIVE',
      );
      expect(mockFormRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: false } }),
      );
    });

    it('searches title OR description as an ILIKe pair, preserving other filters on each branch', async () => {
      mockFormRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.listForms(1, 20, '  choir  ', FormPurpose.VOTE);
      const call = mockFormRepo.findAndCount.mock.calls[0][0];
      expect(call.where).toHaveLength(2);
      expect(call.where[0]).toEqual(
        expect.objectContaining({ purpose: FormPurpose.VOTE }),
      );
      expect(call.where[1]).toEqual(
        expect.objectContaining({ purpose: FormPurpose.VOTE }),
      );
    });

    it('applies page/limit to skip/take', async () => {
      mockFormRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.listForms(3, 10);
      expect(mockFormRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  describe('getFormOptions', () => {
    it('returns a lightweight id/title/fields projection, ordered by title', async () => {
      mockFormRepo.find.mockResolvedValue([
        {
          id: 'form-2',
          title: 'Zebra',
          fields: [
            { id: 'f2', pageIndex: 1 },
            { id: 'f1', pageIndex: 0 },
          ],
        },
        { id: 'form-1', title: 'Alpha', fields: [] },
      ]);
      const result = await service.getFormOptions();
      expect(mockFormRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { title: 'ASC', fields: { order: 'ASC' } },
        }),
      );
      expect(result).toEqual([
        {
          id: 'form-2',
          title: 'Zebra',
          fields: [
            { id: 'f2', pageIndex: 1 },
            { id: 'f1', pageIndex: 0 },
          ],
        },
        { id: 'form-1', title: 'Alpha', fields: [] },
      ]);
    });

    it('defaults a missing pageIndex to 0', async () => {
      mockFormRepo.find.mockResolvedValue([
        { id: 'form-1', title: 'Old Form', fields: [{ id: 'f1' }] },
      ]);
      const result = await service.getFormOptions();
      expect(result[0].fields[0]).toEqual({ id: 'f1', pageIndex: 0 });
    });
  });
});
