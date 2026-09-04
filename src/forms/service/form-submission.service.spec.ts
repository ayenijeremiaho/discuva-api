import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FormSubmissionService } from './form-submission.service';
import { Form } from '../entity/form.entity';
import { FormSubmission } from '../entity/form-submission.entity';
import { FormFieldAttachment } from '../entity/form-field-attachment.entity';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { FollowUpService } from '../../follow-up/service/follow-up.service';
import { GroupService } from '../../group/service/group.service';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategorySettingsService } from '../../email-category-settings/service/email-category-settings.service';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import {
  FormFieldAutoFill,
  FormFieldType,
  FormFieldVisibilityOperator,
  FormVisibility,
} from '../enum/form.enum';

const mockFormRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
};
const mockSubmissionRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'sub-1', ...v })),
  findOne: jest.fn(),
};
const mockMemberRepo = {
  findOneBy: jest.fn(),
};
const mockAdminQb = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
};
const mockAdminRepo = {
  createQueryBuilder: jest.fn().mockReturnValue(mockAdminQb),
};
const mockFollowUpService = {
  createFirstTimerFromPublicForm: jest.fn().mockResolvedValue({ id: 'ft-1' }),
};
const mockGroupService = {
  getMemberIdsForGroup: jest.fn(),
};
const mockConfigService = {
  get: jest.fn((_key: string, fallback?: string) => fallback ?? 'en-NG'),
};
const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
};
const mockEmailCategorySettingsService = {
  isEnabled: jest.fn().mockResolvedValue(true),
};
const mockAttachmentRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'attachment-1', ...v })),
  delete: jest.fn().mockResolvedValue({ affected: 0 }),
};
const mockCloudinaryService = {
  uploadBuffer: jest.fn().mockResolvedValue({
    secureUrl:
      'https://res.cloudinary.com/test/raw/upload/v1/form-submissions/f.pdf',
    publicId: 'form-submissions/f',
    resourceType: 'raw',
  }),
  deleteByPublicId: jest.fn(),
};

describe('FormSubmissionService', () => {
  let service: FormSubmissionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFollowUpService.createFirstTimerFromPublicForm.mockResolvedValue({
      id: 'ft-1',
    });
    mockAdminQb.getMany.mockResolvedValue([]);
    mockEmailCategorySettingsService.isEnabled.mockResolvedValue(true);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormSubmissionService,
        { provide: getRepositoryToken(Form), useValue: mockFormRepo },
        {
          provide: getRepositoryToken(FormSubmission),
          useValue: mockSubmissionRepo,
        },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        { provide: getRepositoryToken(Admin), useValue: mockAdminRepo },
        {
          provide: getRepositoryToken(FormFieldAttachment),
          useValue: mockAttachmentRepo,
        },
        { provide: FollowUpService, useValue: mockFollowUpService },
        { provide: GroupService, useValue: mockGroupService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: UtilityService, useValue: mockUtilityService },
        {
          provide: EmailCategorySettingsService,
          useValue: mockEmailCategorySettingsService,
        },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
      ],
    }).compile();
    service = module.get(FormSubmissionService);
  });

  describe('getForMember', () => {
    it('404s on an inactive or non-member-visible form', async () => {
      mockFormRepo.findOne.mockResolvedValue(null);
      await expect(service.getForMember('form-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('pre-fills suggested values from the member profile for auto-fill fields', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        isActive: true,
        visibility: FormVisibility.MEMBERS,
        fields: [
          { id: 'f1', autoFillKey: FormFieldAutoFill.FIRST_NAME },
          { id: 'f2', autoFillKey: FormFieldAutoFill.EMAIL },
          { id: 'f3', autoFillKey: null },
        ],
      });
      mockMemberRepo.findOneBy.mockResolvedValue({
        firstname: 'Ada',
        lastname: 'Lovelace',
        email: 'ada@example.com',
        phoneNumber: null,
      });

      const result = await service.getForMember('form-1', 'member-1');

      expect(result.suggestedValues).toEqual({
        f1: 'Ada',
        f2: 'ada@example.com',
      });
    });
  });

  describe('getForPublic', () => {
    it('404s on a MEMBERS-only form even if active', async () => {
      mockFormRepo.findOne.mockResolvedValue(null);
      await expect(service.getForPublic('form-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockFormRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ visibility: FormVisibility.PUBLIC }),
        }),
      );
    });
  });

  describe('submitAsMember / submitAsPublic — answer validation', () => {
    const formWithRequiredField = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      fields: [
        {
          id: 'f1',
          label: 'Full Name',
          required: true,
          fieldType: FormFieldType.TEXT,
        },
      ],
    };

    it('rejects a missing required field', async () => {
      mockFormRepo.findOne.mockResolvedValue(formWithRequiredField);
      await expect(service.submitAsPublic('form-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a DROPDOWN answer outside the configured options', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        isActive: true,
        visibility: FormVisibility.PUBLIC,
        fields: [
          {
            id: 'f1',
            label: 'Team',
            required: true,
            fieldType: FormFieldType.DROPDOWN,
            options: ['Ushering', 'Choir'],
          },
        ],
      });
      await expect(
        service.submitAsPublic('form-1', { f1: 'Not A Real Team' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('saves a valid public submission with member null', async () => {
      mockFormRepo.findOne.mockResolvedValue(formWithRequiredField);
      const result = await service.submitAsPublic('form-1', {
        f1: 'Jane Doe',
      });
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ member: null, answers: { f1: 'Jane Doe' } }),
      );
      expect(result.submissionId).toBe('sub-1');
    });

    it('saves a valid member submission with memberId from the token, not the body', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...formWithRequiredField,
        visibility: FormVisibility.MEMBERS,
      });
      await service.submitAsMember('form-1', 'member-42', { f1: 'Jane Doe' });
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ member: { id: 'member-42' } }),
      );
    });

    it('rejects a member submission to a form that is not member-visible', async () => {
      mockFormRepo.findOne.mockResolvedValue(null);
      await expect(
        service.submitAsMember('form-1', 'member-42', { f1: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('submitAsAdmin', () => {
    const adminOnlyForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.ADMIN_ONLY,
      fields: [
        {
          id: 'f1',
          label: 'Child Name',
          required: true,
          fieldType: FormFieldType.TEXT,
        },
      ],
    };

    it('saves a submission with member null when no memberId is given', async () => {
      mockFormRepo.findOne.mockResolvedValue(adminOnlyForm);
      const result = await service.submitAsAdmin('form-1', { f1: 'Baby Jane' });
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ member: null, answers: { f1: 'Baby Jane' } }),
      );
      expect(result.submissionId).toBe('sub-1');
    });

    it('links the submission to the given member when memberId is provided', async () => {
      mockFormRepo.findOne.mockResolvedValue(adminOnlyForm);
      await service.submitAsAdmin('form-1', { f1: 'Baby Jane' }, 'member-42');
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ member: { id: 'member-42' } }),
      );
    });

    it('works against a MEMBERS-visibility form too, not just ADMIN_ONLY', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...adminOnlyForm,
        visibility: FormVisibility.MEMBERS,
      });
      await expect(
        service.submitAsAdmin('form-1', { f1: 'Baby Jane' }),
      ).resolves.toBeDefined();
    });

    it('404s on an inactive form', async () => {
      mockFormRepo.findOne.mockResolvedValue(null);
      await expect(
        service.submitAsAdmin('form-1', { f1: 'Baby Jane' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockFormRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'form-1', isActive: true },
        order: { fields: { order: 'ASC' } },
      });
    });

    it('still validates answers against the form fields', async () => {
      mockFormRepo.findOne.mockResolvedValue(adminOnlyForm);
      await expect(service.submitAsAdmin('form-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('never strips an answer for a visibilityRule field, unlike the member/public paths', async () => {
      // The admin record-entry UI shows every field unconditionally,
      // ignoring visibilityRule — so an answer reaching here was always
      // something an admin actually saw and typed, never a stale leftover.
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        isActive: true,
        visibility: FormVisibility.ADMIN_ONLY,
        fields: [
          {
            id: 'f1',
            label: 'Team',
            required: false,
            fieldType: FormFieldType.DROPDOWN,
            options: ['Choir', 'Ushering'],
          },
          {
            id: 'f2',
            label: 'Team Lead Name',
            required: false,
            fieldType: FormFieldType.TEXT,
            visibilityRule: {
              fieldId: 'f1',
              operator: FormFieldVisibilityOperator.EQUALS,
              value: 'Choir',
            },
          },
        ],
      });
      await service.submitAsAdmin('form-1', { f1: 'Ushering', f2: 'Ada' });
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ answers: { f1: 'Ushering', f2: 'Ada' } }),
      );
    });
  });

  describe('submitAsPublic — createsFirstTimers auto-creation', () => {
    const firstTimerForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      createsFirstTimers: true,
      fields: [
        {
          id: 'f1',
          label: 'First Name',
          required: true,
          fieldType: FormFieldType.TEXT,
          autoFillKey: FormFieldAutoFill.FIRST_NAME,
        },
        {
          id: 'f2',
          label: 'Last Name',
          required: true,
          fieldType: FormFieldType.TEXT,
          autoFillKey: FormFieldAutoFill.LAST_NAME,
        },
        {
          id: 'f3',
          label: 'Phone',
          required: true,
          fieldType: FormFieldType.PHONE,
          autoFillKey: FormFieldAutoFill.PHONE_NUMBER,
        },
        {
          id: 'f4',
          label: 'Email',
          required: false,
          fieldType: FormFieldType.EMAIL,
          autoFillKey: FormFieldAutoFill.EMAIL,
        },
      ],
    };

    it('maps submitted answers to a CreateFirstTimerDto via each field autoFillKey', async () => {
      mockFormRepo.findOne.mockResolvedValue(firstTimerForm);

      await service.submitAsPublic('form-1', {
        f1: 'Chris',
        f2: 'Okafor',
        f3: '+2348012345678',
        f4: 'chris@example.com',
      });

      expect(
        mockFollowUpService.createFirstTimerFromPublicForm,
      ).toHaveBeenCalledWith({
        firstname: 'Chris',
        lastname: 'Okafor',
        phone: '+2348012345678',
        email: 'chris@example.com',
      });
    });

    it('leaves email undefined when not answered', async () => {
      mockFormRepo.findOne.mockResolvedValue(firstTimerForm);

      await service.submitAsPublic('form-1', {
        f1: 'Chris',
        f2: 'Okafor',
        f3: '+2348012345678',
      });

      expect(
        mockFollowUpService.createFirstTimerFromPublicForm,
      ).toHaveBeenCalledWith(expect.objectContaining({ email: undefined }));
    });

    it('does not call FollowUpService when createsFirstTimers is false', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...firstTimerForm,
        createsFirstTimers: false,
      });

      await service.submitAsPublic('form-1', {
        f1: 'Chris',
        f2: 'Okafor',
        f3: '+2348012345678',
      });

      expect(
        mockFollowUpService.createFirstTimerFromPublicForm,
      ).not.toHaveBeenCalled();
    });

    it('still saves the submission even if first-timer creation fails', async () => {
      mockFormRepo.findOne.mockResolvedValue(firstTimerForm);
      mockFollowUpService.createFirstTimerFromPublicForm.mockRejectedValueOnce(
        new Error('No active Follow-Up team members available.'),
      );

      const result = await service.submitAsPublic('form-1', {
        f1: 'Chris',
        f2: 'Okafor',
        f3: '+2348012345678',
      });

      expect(result.submissionId).toBe('sub-1');
    });
  });

  describe('phone normalization', () => {
    const phoneForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      fields: [
        {
          id: 'f1',
          label: 'WhatsApp Number',
          required: true,
          fieldType: FormFieldType.PHONE,
        },
      ],
    };

    it('normalizes a leading-zero Nigerian number before saving', async () => {
      mockFormRepo.findOne.mockResolvedValue(phoneForm);
      await service.submitAsPublic('form-1', { f1: '08012345678' });
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ answers: { f1: '+2348012345678' } }),
      );
    });

    it('rejects a required phone field that fails to normalize', async () => {
      mockFormRepo.findOne.mockResolvedValue(phoneForm);
      await expect(
        service.submitAsPublic('form-1', { f1: 'not a phone number' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('duplicate-submission prevention', () => {
    const dedupForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      dedupField: { id: 'f1', fieldType: FormFieldType.PHONE },
      fields: [
        {
          id: 'f1',
          label: 'WhatsApp Number',
          required: true,
          fieldType: FormFieldType.PHONE,
        },
      ],
    };

    it('computes a normalized dedup value on save', async () => {
      mockFormRepo.findOne.mockResolvedValue(dedupForm);
      await service.submitAsPublic('form-1', { f1: '08012345678' });
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ dedupValueNormalized: '+2348012345678' }),
      );
    });

    it('translates a unique-constraint violation into a friendly error carrying a distinct code', async () => {
      expect.assertions(2);
      mockFormRepo.findOne.mockResolvedValue(dedupForm);
      mockSubmissionRepo.save.mockRejectedValueOnce({ code: '23505' });
      await service
        .submitAsPublic('form-1', { f1: '08012345678' })
        .catch((err) => {
          expect(err).toBeInstanceOf(BadRequestException);
          const response = (err as BadRequestException).getResponse() as {
            code?: string;
          };
          expect(response.code).toBe('DUPLICATE_SUBMISSION');
        });
    });

    it('rethrows any other save error unchanged', async () => {
      mockFormRepo.findOne.mockResolvedValue(dedupForm);
      mockSubmissionRepo.save.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.submitAsPublic('form-1', { f1: '08012345678' }),
      ).rejects.toThrow('db down');
    });
  });

  describe('dynamic next-steps response', () => {
    const nextStepsForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      postSubmitMessage: 'Thanks for signing up!',
      nextStepsField: {
        id: 'f1',
        fieldType: FormFieldType.DROPDOWN,
        optionMetadata: {
          Choir: {
            url: 'https://chat.example.com/choir',
            description: 'Choir team',
          },
          Ushering: { url: 'https://chat.example.com/ushering' },
        },
      },
      fields: [
        {
          id: 'f1',
          label: 'Department',
          required: true,
          fieldType: FormFieldType.DROPDOWN,
          options: ['Choir', 'Ushering'],
        },
      ],
    };

    it("returns only the selected option's metadata, not the others", async () => {
      mockFormRepo.findOne.mockResolvedValue(nextStepsForm);
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps).toEqual({
        message: 'Thanks for signing up!',
        generalAction: null,
        selectedOption: {
          value: 'Choir',
          url: 'https://chat.example.com/choir',
          description: 'Choir team',
        },
      });
      expect(JSON.stringify(result)).not.toContain('ushering');
    });

    it('returns null selectedOption when no next-steps field is configured', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...nextStepsForm,
        nextStepsField: null,
      });
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps.selectedOption).toBeNull();
    });

    it('returns the general action alongside the selected option when both are configured', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...nextStepsForm,
        generalActionUrl: 'https://chat.example.com/main-group',
        generalActionLabel: 'Join Main Volunteer Group',
      });
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps.generalAction).toEqual({
        label: 'Join Main Volunteer Group',
        url: 'https://chat.example.com/main-group',
      });
      expect(result.nextSteps.selectedOption?.value).toBe('Choir');
    });

    it('omits the general action when only one of url/label is set on the entity', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...nextStepsForm,
        generalActionUrl: 'https://chat.example.com/main-group',
        generalActionLabel: null,
      });
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps.generalAction).toBeNull();
    });
  });

  describe('postSubmitOutcomes (ranked conditional message/action)', () => {
    const outcomesForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      postSubmitMessage: 'Thanks for signing up!',
      generalActionUrl: 'https://chat.example.com/main-group',
      generalActionLabel: 'Join Main Volunteer Group',
      nextStepsField: null,
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
          actionUrl: 'https://chat.example.com/choir',
          actionLabel: 'Join Choir Group',
        },
        {
          conditions: [
            {
              fieldId: 'f1',
              operator: FormFieldVisibilityOperator.EQUALS,
              value: 'Ushering',
            },
          ],
          message: 'Welcome to Ushering!',
          actionUrl: null,
          actionLabel: null,
        },
      ],
      fields: [
        {
          id: 'f1',
          label: 'Department',
          required: true,
          fieldType: FormFieldType.DROPDOWN,
          options: ['Choir', 'Ushering', 'Media'],
        },
      ],
    };

    it('replaces both message and generalAction when a matching outcome is found', async () => {
      mockFormRepo.findOne.mockResolvedValue(outcomesForm);
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps.message).toBe('Welcome to Choir!');
      expect(result.nextSteps.generalAction).toEqual({
        label: 'Join Choir Group',
        url: 'https://chat.example.com/choir',
      });
    });

    it("falls back to the form's static general action when the matching outcome leaves it blank", async () => {
      mockFormRepo.findOne.mockResolvedValue(outcomesForm);
      const result = await service.submitAsPublic('form-1', {
        f1: 'Ushering',
      });
      expect(result.nextSteps.message).toBe('Welcome to Ushering!');
      expect(result.nextSteps.generalAction).toEqual({
        label: 'Join Main Volunteer Group',
        url: 'https://chat.example.com/main-group',
      });
    });

    it('hides the general action when both the matching outcome and the static default leave it blank — lets a rule opt out without inheriting an unrelated default', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...outcomesForm,
        generalActionUrl: null,
        generalActionLabel: null,
      });
      const result = await service.submitAsPublic('form-1', {
        f1: 'Ushering',
      });
      expect(result.nextSteps.generalAction).toBeNull();
    });

    it("uses the matching outcome's own message while falling back to the static general action independently", async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...outcomesForm,
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
      });
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps.message).toBe('Welcome to Choir!');
      expect(result.nextSteps.generalAction).toEqual({
        label: 'Join Main Volunteer Group',
        url: 'https://chat.example.com/main-group',
      });
    });

    it('falls back to the static message/generalAction when no outcome matches', async () => {
      mockFormRepo.findOne.mockResolvedValue(outcomesForm);
      const result = await service.submitAsPublic('form-1', { f1: 'Media' });
      expect(result.nextSteps.message).toBe('Thanks for signing up!');
      expect(result.nextSteps.generalAction).toEqual({
        label: 'Join Main Volunteer Group',
        url: 'https://chat.example.com/main-group',
      });
    });

    it('falls back to the static values when no outcomes are configured at all', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...outcomesForm,
        postSubmitOutcomes: null,
      });
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps.message).toBe('Thanks for signing up!');
    });

    it('the first matching outcome wins over a later one that would also match', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...outcomesForm,
        postSubmitOutcomes: [
          {
            conditions: [
              {
                fieldId: 'f1',
                operator: FormFieldVisibilityOperator.NOT_EQUALS,
                value: 'Media',
              },
            ],
            message: 'First rule wins',
            actionUrl: null,
            actionLabel: null,
          },
          {
            conditions: [
              {
                fieldId: 'f1',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: 'Choir',
              },
            ],
            message: 'Second rule',
            actionUrl: null,
            actionLabel: null,
          },
        ],
      });
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps.message).toBe('First rule wins');
    });

    it('requires every condition in an outcome to match (AND), not just one', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...outcomesForm,
        fields: [
          ...outcomesForm.fields,
          {
            id: 'f2',
            label: 'Experience',
            required: false,
            fieldType: FormFieldType.TEXT,
          },
        ],
        postSubmitOutcomes: [
          {
            conditions: [
              {
                fieldId: 'f1',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: 'Choir',
              },
              {
                fieldId: 'f2',
                operator: FormFieldVisibilityOperator.EQUALS,
                value: '5+ years',
              },
            ],
            message: 'Welcome back to the choir family!',
            actionUrl: null,
            actionLabel: null,
          },
        ],
      });
      const partialMatch = await service.submitAsPublic('form-1', {
        f1: 'Choir',
        f2: '1 year',
      });
      expect(partialMatch.nextSteps.message).toBe('Thanks for signing up!');

      const fullMatch = await service.submitAsPublic('form-1', {
        f1: 'Choir',
        f2: '5+ years',
      });
      expect(fullMatch.nextSteps.message).toBe(
        'Welcome back to the choir family!',
      );
    });

    it('still resolves the selectedOption from nextStepsField independently of outcomes', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...outcomesForm,
        nextStepsField: {
          id: 'f1',
          fieldType: FormFieldType.DROPDOWN,
          optionMetadata: {
            Choir: { url: 'https://chat.example.com/choir-info' },
          },
        },
      });
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps.message).toBe('Welcome to Choir!');
      expect(result.nextSteps.selectedOption).toEqual({
        value: 'Choir',
        url: 'https://chat.example.com/choir-info',
        description: null,
      });
    });

    it('hides the message when the matching outcome sets hideMessage, even though a static default exists', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...outcomesForm,
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
      });
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps.message).toBeNull();
      expect(result.nextSteps.generalAction).toEqual({
        label: 'Join Main Volunteer Group',
        url: 'https://chat.example.com/main-group',
      });
    });

    it('hides the general action when the matching outcome sets hideAction, even though a static default exists', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...outcomesForm,
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
            hideMessage: false,
            actionUrl: null,
            actionLabel: null,
            hideAction: true,
          },
        ],
      });
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps.message).toBe('Thanks for signing up!');
      expect(result.nextSteps.generalAction).toBeNull();
    });

    it('resolves hideMessage and hideAction independently — one hidden, the other custom', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...outcomesForm,
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
            actionUrl: 'https://chat.example.com/choir',
            actionLabel: 'Join Choir Group',
            hideAction: false,
          },
        ],
      });
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps.message).toBeNull();
      expect(result.nextSteps.generalAction).toEqual({
        label: 'Join Choir Group',
        url: 'https://chat.example.com/choir',
      });
    });

    it('hides both message and action when the matching outcome sets both flags', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...outcomesForm,
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
            hideAction: true,
          },
        ],
      });
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps.message).toBeNull();
      expect(result.nextSteps.generalAction).toBeNull();
    });
  });

  describe('type validation', () => {
    const emailForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      fields: [
        {
          id: 'f1',
          label: 'Work Email',
          required: true,
          fieldType: FormFieldType.EMAIL,
        },
      ],
    };
    const numberForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      fields: [
        {
          id: 'f1',
          label: 'Age',
          required: true,
          fieldType: FormFieldType.NUMBER,
        },
      ],
    };
    const dateForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      fields: [
        {
          id: 'f1',
          label: 'Birthday',
          required: false,
          fieldType: FormFieldType.DATE,
        },
      ],
    };

    it('accepts a valid EMAIL answer', async () => {
      mockFormRepo.findOne.mockResolvedValue(emailForm);
      await expect(
        service.submitAsPublic('form-1', { f1: 'jane@example.com' }),
      ).resolves.toBeDefined();
    });

    it('rejects an EMAIL answer that is not a valid email address', async () => {
      mockFormRepo.findOne.mockResolvedValue(emailForm);
      await expect(
        service.submitAsPublic('form-1', { f1: 'not-an-email' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid NUMBER answer', async () => {
      mockFormRepo.findOne.mockResolvedValue(numberForm);
      await expect(
        service.submitAsPublic('form-1', { f1: '42' }),
      ).resolves.toBeDefined();
    });

    it('rejects a NUMBER answer that is not numeric', async () => {
      mockFormRepo.findOne.mockResolvedValue(numberForm);
      await expect(
        service.submitAsPublic('form-1', { f1: 'not a number' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid DATE answer', async () => {
      mockFormRepo.findOne.mockResolvedValue(dateForm);
      await expect(
        service.submitAsPublic('form-1', { f1: '2026-01-15' }),
      ).resolves.toBeDefined();
    });

    it('rejects a DATE answer that is not a valid date', async () => {
      mockFormRepo.findOne.mockResolvedValue(dateForm);
      await expect(
        service.submitAsPublic('form-1', { f1: 'not a date' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('skips type validation for an empty optional DATE field', async () => {
      mockFormRepo.findOne.mockResolvedValue(dateForm);
      await expect(service.submitAsPublic('form-1', {})).resolves.toBeDefined();
    });
  });

  describe('field bounds validation', () => {
    const numberForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      fields: [
        {
          id: 'f1',
          label: 'Age',
          required: true,
          fieldType: FormFieldType.NUMBER,
          minValue: 18,
          maxValue: 65,
        },
      ],
    };
    const textForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      fields: [
        {
          id: 'f1',
          label: 'Bio',
          required: true,
          fieldType: FormFieldType.TEXT,
          minLength: 5,
          maxLength: 10,
        },
      ],
    };
    const checkboxForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      fields: [
        {
          id: 'f1',
          label: 'Interests',
          required: true,
          fieldType: FormFieldType.CHECKBOX,
          options: ['Choir', 'Ushering', 'Media'],
          minSelections: 1,
          maxSelections: 2,
        },
      ],
    };

    it('accepts a NUMBER answer within bounds', async () => {
      mockFormRepo.findOne.mockResolvedValue(numberForm);
      await expect(
        service.submitAsPublic('form-1', { f1: '30' }),
      ).resolves.toBeDefined();
    });

    it('rejects a NUMBER answer below minValue', async () => {
      mockFormRepo.findOne.mockResolvedValue(numberForm);
      await expect(
        service.submitAsPublic('form-1', { f1: '10' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a NUMBER answer above maxValue', async () => {
      mockFormRepo.findOne.mockResolvedValue(numberForm);
      await expect(
        service.submitAsPublic('form-1', { f1: '99' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a TEXT answer shorter than minLength', async () => {
      mockFormRepo.findOne.mockResolvedValue(textForm);
      await expect(
        service.submitAsPublic('form-1', { f1: 'hi' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a TEXT answer longer than maxLength', async () => {
      mockFormRepo.findOne.mockResolvedValue(textForm);
      await expect(
        service.submitAsPublic('form-1', { f1: 'way too long a bio' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a TEXT answer within length bounds', async () => {
      mockFormRepo.findOne.mockResolvedValue(textForm);
      await expect(
        service.submitAsPublic('form-1', { f1: 'hello!' }),
      ).resolves.toBeDefined();
    });

    it('rejects fewer CHECKBOX selections than minSelections', async () => {
      mockFormRepo.findOne.mockResolvedValue(checkboxForm);
      await expect(
        service.submitAsPublic('form-1', { f1: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects more CHECKBOX selections than maxSelections', async () => {
      mockFormRepo.findOne.mockResolvedValue(checkboxForm);
      await expect(
        service.submitAsPublic('form-1', {
          f1: ['Choir', 'Ushering', 'Media'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a CHECKBOX selection count within bounds', async () => {
      mockFormRepo.findOne.mockResolvedValue(checkboxForm);
      await expect(
        service.submitAsPublic('form-1', { f1: ['Choir'] }),
      ).resolves.toBeDefined();
    });

    it('skips bound checks entirely when no bounds are configured', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...numberForm,
        fields: [{ ...numberForm.fields[0], minValue: null, maxValue: null }],
      });
      await expect(
        service.submitAsPublic('form-1', { f1: '999999' }),
      ).resolves.toBeDefined();
    });
  });

  describe('validationRegex validation', () => {
    const ninForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      fields: [
        {
          id: 'f1',
          label: 'NIN',
          required: true,
          fieldType: FormFieldType.TEXT,
          validationRegex: '^\\d{11}$',
          validationMessage: 'Must be an 11-digit NIN',
        },
      ],
    };

    it('accepts an answer matching the pattern', async () => {
      mockFormRepo.findOne.mockResolvedValue(ninForm);
      await expect(
        service.submitAsPublic('form-1', { f1: '12345678901' }),
      ).resolves.toBeDefined();
    });

    it('rejects an answer that does not match the pattern, using the custom message', async () => {
      mockFormRepo.findOne.mockResolvedValue(ninForm);
      await expect(
        service.submitAsPublic('form-1', { f1: 'not-a-nin' }),
      ).rejects.toThrow('Must be an 11-digit NIN');
    });

    it('falls back to a generic message when no validationMessage is set', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...ninForm,
        fields: [{ ...ninForm.fields[0], validationMessage: null }],
      });
      await expect(
        service.submitAsPublic('form-1', { f1: 'nope' }),
      ).rejects.toThrow('is not in the required format');
    });

    it('skips the check entirely when no validationRegex is configured', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...ninForm,
        fields: [{ ...ninForm.fields[0], validationRegex: null }],
      });
      await expect(
        service.submitAsPublic('form-1', { f1: 'anything at all' }),
      ).resolves.toBeDefined();
    });
  });

  describe('conditional visibility (visibilityRule)', () => {
    const teamField = {
      id: 'f1',
      label: 'Team',
      required: false,
      fieldType: FormFieldType.DROPDOWN,
      options: ['Choir', 'Ushering'],
    };

    function formWithLeadRule(rule: {
      operator: FormFieldVisibilityOperator;
      value: string;
    }) {
      return {
        id: 'form-1',
        isActive: true,
        visibility: FormVisibility.PUBLIC,
        fields: [
          teamField,
          {
            id: 'f2',
            label: 'Team Lead Name',
            required: true,
            fieldType: FormFieldType.TEXT,
            visibilityRule: { fieldId: 'f1', ...rule },
          },
        ],
      };
    }

    it('does not require a conditionally-hidden field, even though it is required', async () => {
      mockFormRepo.findOne.mockResolvedValue(
        formWithLeadRule({
          operator: FormFieldVisibilityOperator.EQUALS,
          value: 'Choir',
        }),
      );
      // f1 answered "Ushering", so the EQUALS "Choir" rule hides f2 — its
      // required check must never fire despite f2 being left unanswered.
      await expect(
        service.submitAsPublic('form-1', { f1: 'Ushering' }),
      ).resolves.toBeDefined();
    });

    it('requires a conditionally-visible field once its condition is met', async () => {
      mockFormRepo.findOne.mockResolvedValue(
        formWithLeadRule({
          operator: FormFieldVisibilityOperator.EQUALS,
          value: 'Choir',
        }),
      );
      await expect(
        service.submitAsPublic('form-1', { f1: 'Choir' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts the submission once the now-visible required field is answered', async () => {
      mockFormRepo.findOne.mockResolvedValue(
        formWithLeadRule({
          operator: FormFieldVisibilityOperator.EQUALS,
          value: 'Choir',
        }),
      );
      await expect(
        service.submitAsPublic('form-1', { f1: 'Choir', f2: 'Ada' }),
      ).resolves.toBeDefined();
    });

    it('notEquals shows the field whenever the target does NOT match', async () => {
      mockFormRepo.findOne.mockResolvedValue(
        formWithLeadRule({
          operator: FormFieldVisibilityOperator.NOT_EQUALS,
          value: 'Choir',
        }),
      );
      await expect(
        service.submitAsPublic('form-1', { f1: 'Ushering' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('includes matches against a CHECKBOX-style array answer', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        isActive: true,
        visibility: FormVisibility.PUBLIC,
        fields: [
          {
            id: 'f1',
            label: 'Interests',
            required: false,
            fieldType: FormFieldType.CHECKBOX,
            options: ['Choir', 'Media'],
          },
          {
            id: 'f2',
            label: 'Team Lead Name',
            required: true,
            fieldType: FormFieldType.TEXT,
            visibilityRule: {
              fieldId: 'f1',
              operator: FormFieldVisibilityOperator.INCLUDES,
              value: 'Choir',
            },
          },
        ],
      });
      await expect(
        service.submitAsPublic('form-1', { f1: ['Choir', 'Media'] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.submitAsPublic('form-1', { f1: ['Media'] }),
      ).resolves.toBeDefined();
    });

    it('never blocks submission on a hidden field even with other validation configured (bounds/format)', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        id: 'form-1',
        isActive: true,
        visibility: FormVisibility.PUBLIC,
        fields: [
          teamField,
          {
            id: 'f2',
            label: 'Age',
            required: true,
            fieldType: FormFieldType.NUMBER,
            minValue: 18,
            visibilityRule: {
              fieldId: 'f1',
              operator: FormFieldVisibilityOperator.EQUALS,
              value: 'Choir',
            },
          },
        ],
      });
      // Hidden (f1 !== "Choir") — a garbage value that would otherwise
      // fail both the NUMBER format check and the minValue bound is
      // ignored entirely, not just exempted from the required check.
      await expect(
        service.submitAsPublic('form-1', {
          f1: 'Ushering',
          f2: 'not-a-number',
        }),
      ).resolves.toBeDefined();
    });

    it("strips a hidden field's leftover answer before persisting, on submit", async () => {
      mockFormRepo.findOne.mockResolvedValue(
        formWithLeadRule({
          operator: FormFieldVisibilityOperator.EQUALS,
          value: 'Choir',
        }),
      );
      // f1 answered "Ushering" hides f2 — but f2 still carries a value the
      // member typed before switching f1 away from "Choir" (the fill UI
      // only stops rendering a hidden field; it never clears its own local
      // edit state). That stale value must never reach the saved record.
      await service.submitAsPublic('form-1', {
        f1: 'Ushering',
        f2: 'Stale Leftover Name',
      });
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ answers: { f1: 'Ushering' } }),
      );
    });

    it("keeps a field's answer once it becomes visible", async () => {
      mockFormRepo.findOne.mockResolvedValue(
        formWithLeadRule({
          operator: FormFieldVisibilityOperator.EQUALS,
          value: 'Choir',
        }),
      );
      await service.submitAsPublic('form-1', { f1: 'Choir', f2: 'Ada' });
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ answers: { f1: 'Choir', f2: 'Ada' } }),
      );
    });
  });

  describe('admin notification on submission', () => {
    const notifyingForm = {
      id: 'form-1',
      title: 'Volunteer Sign-up',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      notifyOnSubmission: true,
      fields: [
        {
          id: 'f1',
          label: 'Name',
          required: false,
          fieldType: FormFieldType.TEXT,
        },
      ],
    };
    const notifiedAdmin = {
      isActive: true,
      member: { email: 'admin@example.com' },
      adminRole: { permissions: ['forms:write'] },
    };

    it('emails admins with forms:write when both the form and category toggles are on', async () => {
      mockFormRepo.findOne.mockResolvedValue(notifyingForm);
      mockAdminQb.getMany.mockResolvedValue([notifiedAdmin]);

      await service.submitAsPublic('form-1', { f1: 'Jane' });
      await new Promise(process.nextTick);

      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'admin@example.com',
        expect.stringContaining('Volunteer Sign-up'),
        'form-submission-new',
        expect.objectContaining({ formTitle: 'Volunteer Sign-up' }),
        undefined,
        'FORM_SUBMISSION',
      );
    });

    it('does not email admins lacking forms:write', async () => {
      mockFormRepo.findOne.mockResolvedValue(notifyingForm);
      mockAdminQb.getMany.mockResolvedValue([
        {
          isActive: true,
          member: { email: 'x@example.com' },
          adminRole: { permissions: [] },
        },
      ]);

      await service.submitAsPublic('form-1', { f1: 'Jane' });
      await new Promise(process.nextTick);

      expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
    });

    it('skips notification entirely when the form has notifyOnSubmission off', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...notifyingForm,
        notifyOnSubmission: false,
      });
      mockAdminQb.getMany.mockResolvedValue([notifiedAdmin]);

      await service.submitAsPublic('form-1', { f1: 'Jane' });
      await new Promise(process.nextTick);

      expect(mockAdminRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
    });

    it('skips notification when the tenant-wide FORM_SUBMISSION category is disabled', async () => {
      mockFormRepo.findOne.mockResolvedValue(notifyingForm);
      mockAdminQb.getMany.mockResolvedValue([notifiedAdmin]);
      mockEmailCategorySettingsService.isEnabled.mockResolvedValue(false);

      await service.submitAsPublic('form-1', { f1: 'Jane' });
      await new Promise(process.nextTick);

      expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
    });

    it('never notifies on submitAsAdmin', async () => {
      mockFormRepo.findOne.mockResolvedValue(notifyingForm);
      mockAdminQb.getMany.mockResolvedValue([notifiedAdmin]);

      await service.submitAsAdmin('form-1', { f1: 'Jane' });
      await new Promise(process.nextTick);

      expect(mockAdminRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
    });
  });

  describe('audience-group restriction', () => {
    const restrictedForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.MEMBERS,
      audienceGroup: { id: 'group-1' },
      fields: [
        {
          id: 'f1',
          label: 'Name',
          required: false,
          fieldType: FormFieldType.TEXT,
        },
      ],
    };

    it('getForMember 404s for a member outside the audience group', async () => {
      mockFormRepo.findOne.mockResolvedValue(restrictedForm);
      mockGroupService.getMemberIdsForGroup.mockResolvedValue([
        'member-in-group',
      ]);
      await expect(
        service.getForMember('form-1', 'member-outside'),
      ).rejects.toThrow(NotFoundException);
    });

    it('getForMember succeeds for a member inside the audience group', async () => {
      mockFormRepo.findOne.mockResolvedValue(restrictedForm);
      mockGroupService.getMemberIdsForGroup.mockResolvedValue([
        'member-in-group',
      ]);
      mockMemberRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.getForMember('form-1', 'member-in-group'),
      ).resolves.toBeDefined();
    });

    it('submitAsMember rejects a member outside the audience group', async () => {
      mockFormRepo.findOne.mockResolvedValue(restrictedForm);
      mockGroupService.getMemberIdsForGroup.mockResolvedValue([
        'member-in-group',
      ]);
      await expect(
        service.submitAsMember('form-1', 'member-outside', {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('uploadAttachment', () => {
    const fileField = {
      id: 'f1',
      label: 'Proof of Payment',
      required: true,
      fieldType: FormFieldType.FILE,
    };
    const fileForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      fields: [fileField],
    };
    const fakeFile = {
      buffer: Buffer.from('pdf'),
      mimetype: 'application/pdf',
    } as Express.Multer.File;

    it('uploads to Cloudinary, tracks the row, and returns url+publicId', async () => {
      mockFormRepo.findOne.mockResolvedValue(fileForm);

      const result = await service.uploadAttachment('form-1', 'f1', fakeFile, [
        FormVisibility.PUBLIC,
      ]);

      expect(mockCloudinaryService.uploadBuffer).toHaveBeenCalledWith(
        fakeFile.buffer,
        'form-submissions',
        undefined,
        'application/pdf',
      );
      expect(mockAttachmentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          formId: 'form-1',
          fieldId: 'f1',
          publicId: 'form-submissions/f',
          resourceType: 'raw',
        }),
      );
      expect(result).toEqual({
        url: 'https://res.cloudinary.com/test/raw/upload/v1/form-submissions/f.pdf',
        publicId: 'form-submissions/f',
      });
    });

    it('rejects an unknown field id', async () => {
      mockFormRepo.findOne.mockResolvedValue(fileForm);
      await expect(
        service.uploadAttachment('form-1', 'unknown-field', fakeFile, [
          FormVisibility.PUBLIC,
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a field that is not FILE type', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...fileForm,
        fields: [{ ...fileField, fieldType: FormFieldType.TEXT }],
      });
      await expect(
        service.uploadAttachment('form-1', 'f1', fakeFile, [
          FormVisibility.PUBLIC,
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s when the form is not visible to the given allowlist', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...fileForm,
        visibility: FormVisibility.ADMIN_ONLY,
      });
      await expect(
        service.uploadAttachment('form-1', 'f1', fakeFile, [
          FormVisibility.PUBLIC,
        ]),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a member outside the audience group', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...fileForm,
        visibility: FormVisibility.MEMBERS,
        audienceGroup: { id: 'group-1' },
      });
      mockGroupService.getMemberIdsForGroup.mockResolvedValue([
        'member-in-group',
      ]);
      await expect(
        service.uploadAttachment(
          'form-1',
          'f1',
          fakeFile,
          [FormVisibility.MEMBERS],
          'member-outside',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('skips the audience-group check when no memberId is given (public/admin uploads)', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...fileForm,
        visibility: FormVisibility.MEMBERS,
        audienceGroup: { id: 'group-1' },
      });
      await expect(
        service.uploadAttachment('form-1', 'f1', fakeFile, [
          FormVisibility.MEMBERS,
        ]),
      ).resolves.toBeDefined();
      expect(mockGroupService.getMemberIdsForGroup).not.toHaveBeenCalled();
    });
  });

  describe('getMySubmission', () => {
    const editableForm = {
      id: 'form-1',
      isActive: true,
      editableAfterSubmit: true,
      fields: [{ id: 'f1', label: 'Name', fieldType: FormFieldType.TEXT }],
    };

    it('returns the most recent submission for the caller, with editable from the form', async () => {
      mockFormRepo.findOne.mockResolvedValue(editableForm);
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        answers: { f1: 'Jane' },
      });

      const result = await service.getMySubmission('form-1', 'member-1');

      expect(mockSubmissionRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { form: { id: 'form-1' }, member: { id: 'member-1' } },
        }),
      );
      expect(result).toEqual({
        submissionId: 'sub-1',
        answers: { f1: 'Jane' },
        editable: true,
      });
    });

    it('reflects editableAfterSubmit:false from the form', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...editableForm,
        editableAfterSubmit: false,
      });
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        answers: { f1: 'Jane' },
      });

      const result = await service.getMySubmission('form-1', 'member-1');

      expect(result.editable).toBe(false);
    });

    it('404s when the caller has no submission for this form', async () => {
      mockFormRepo.findOne.mockResolvedValue(editableForm);
      mockSubmissionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getMySubmission('form-1', 'member-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s when the form itself is gone/inactive', async () => {
      mockFormRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getMySubmission('form-1', 'member-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s for an ADMIN_ONLY form even if the caller is the linked member', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...editableForm,
        visibility: FormVisibility.ADMIN_ONLY,
      });

      await expect(
        service.getMySubmission('form-1', 'member-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateSubmission', () => {
    const editableForm = {
      id: 'form-1',
      isActive: true,
      editableAfterSubmit: true,
      dedupField: null,
      fields: [
        {
          id: 'f1',
          label: 'Name',
          required: true,
          fieldType: FormFieldType.TEXT,
        },
      ],
    };

    it('updates the answers when the caller owns the submission', async () => {
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        answers: { f1: 'Old Name' },
        dedupValueNormalized: null,
        member: { id: 'member-1' },
        form: { id: 'form-1' },
      });
      mockFormRepo.findOne.mockResolvedValue(editableForm);

      const result = await service.updateSubmission('sub-1', 'member-1', {
        f1: 'New Name',
      });

      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ answers: { f1: 'New Name' } }),
      );
      expect(result.submissionId).toBe('sub-1');
    });

    it('404s when the submission does not belong to the caller', async () => {
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        answers: {},
        member: { id: 'someone-else' },
      });

      await expect(
        service.updateSubmission('sub-1', 'member-1', { f1: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s when the submission has no member at all (a public submission)', async () => {
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        answers: {},
        member: null,
      });

      await expect(
        service.updateSubmission('sub-1', 'member-1', { f1: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s when the submission id does not exist', async () => {
      mockSubmissionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateSubmission('missing', 'member-1', { f1: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s for an ADMIN_ONLY form even if the caller is the linked member', async () => {
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        answers: { f1: 'Old' },
        member: { id: 'member-1' },
        form: { id: 'form-1' },
      });
      mockFormRepo.findOne.mockResolvedValue({
        ...editableForm,
        visibility: FormVisibility.ADMIN_ONLY,
      });

      await expect(
        service.updateSubmission('sub-1', 'member-1', { f1: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the form has editableAfterSubmit off', async () => {
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        answers: { f1: 'Old' },
        member: { id: 'member-1' },
        form: { id: 'form-1' },
      });
      mockFormRepo.findOne.mockResolvedValue({
        ...editableForm,
        editableAfterSubmit: false,
      });

      await expect(
        service.updateSubmission('sub-1', 'member-1', { f1: 'New' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('re-validates the new answers through the normal pipeline', async () => {
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        answers: { f1: 'Old' },
        member: { id: 'member-1' },
        form: { id: 'form-1' },
      });
      mockFormRepo.findOne.mockResolvedValue(editableForm);

      await expect(
        service.updateSubmission('sub-1', 'member-1', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it("strips a hidden field's leftover answer before persisting, on edit", async () => {
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        answers: { f1: 'Choir', f2: 'Ada' },
        member: { id: 'member-1' },
        form: { id: 'form-1' },
      });
      mockFormRepo.findOne.mockResolvedValue({
        ...editableForm,
        fields: [
          {
            id: 'f1',
            label: 'Team',
            required: false,
            fieldType: FormFieldType.DROPDOWN,
            options: ['Choir', 'Ushering'],
          },
          {
            id: 'f2',
            label: 'Team Lead Name',
            required: false,
            fieldType: FormFieldType.TEXT,
            visibilityRule: {
              fieldId: 'f1',
              operator: FormFieldVisibilityOperator.EQUALS,
              value: 'Choir',
            },
          },
        ],
      });

      // Switching f1 away from "Choir" hides f2 — its stale prior answer
      // must not survive into the saved record.
      await service.updateSubmission('sub-1', 'member-1', {
        f1: 'Ushering',
        f2: 'Ada',
      });

      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ answers: { f1: 'Ushering' } }),
      );
    });

    it('does not touch dedupValueNormalized when the dedup value is unchanged', async () => {
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        answers: { f1: '08012345678' },
        dedupValueNormalized: '+2348012345678',
        member: { id: 'member-1' },
        form: { id: 'form-1' },
      });
      mockFormRepo.findOne.mockResolvedValue({
        ...editableForm,
        dedupField: { id: 'f1', fieldType: FormFieldType.PHONE },
        fields: [
          {
            id: 'f1',
            label: 'Phone',
            required: true,
            fieldType: FormFieldType.PHONE,
          },
        ],
      });

      await service.updateSubmission('sub-1', 'member-1', {
        f1: '08012345678',
      });

      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ dedupValueNormalized: '+2348012345678' }),
      );
    });

    it('recomputes dedupValueNormalized when the dedup value changed', async () => {
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        answers: { f1: '08012345678' },
        dedupValueNormalized: '+2348012345678',
        member: { id: 'member-1' },
        form: { id: 'form-1' },
      });
      mockFormRepo.findOne.mockResolvedValue({
        ...editableForm,
        dedupField: { id: 'f1', fieldType: FormFieldType.PHONE },
        fields: [
          {
            id: 'f1',
            label: 'Phone',
            required: true,
            fieldType: FormFieldType.PHONE,
          },
        ],
      });

      await service.updateSubmission('sub-1', 'member-1', {
        f1: '08087654321',
      });

      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ dedupValueNormalized: '+2348087654321' }),
      );
    });

    it('translates a unique-constraint violation into DUPLICATE_SUBMISSION', async () => {
      expect.assertions(2);
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        answers: { f1: 'Old Name' },
        member: { id: 'member-1' },
        form: { id: 'form-1' },
      });
      mockFormRepo.findOne.mockResolvedValue(editableForm);
      mockSubmissionRepo.save.mockRejectedValueOnce({ code: '23505' });

      await service
        .updateSubmission('sub-1', 'member-1', { f1: 'New Name' })
        .catch((err) => {
          expect(err).toBeInstanceOf(BadRequestException);
          const response = (err as BadRequestException).getResponse() as {
            code?: string;
          };
          expect(response.code).toBe('DUPLICATE_SUBMISSION');
        });
    });

    it('never calls notifyAdmins on an edit', async () => {
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        answers: { f1: 'Old Name' },
        member: { id: 'member-1' },
        form: { id: 'form-1' },
      });
      mockFormRepo.findOne.mockResolvedValue({
        ...editableForm,
        notifyOnSubmission: true,
      });

      await service.updateSubmission('sub-1', 'member-1', {
        f1: 'New Name',
      });
      await new Promise(process.nextTick);

      expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
    });
  });

  describe('FILE field validation and submit-time cleanup', () => {
    const fileForm = {
      id: 'form-1',
      isActive: true,
      visibility: FormVisibility.PUBLIC,
      fields: [
        {
          id: 'f1',
          label: 'Proof of Payment',
          required: true,
          fieldType: FormFieldType.FILE,
        },
      ],
    };
    const validAnswer = {
      url: 'https://cdn.example.com/f.pdf',
      publicId: 'form-submissions/f',
    };

    it('accepts a well-formed { url, publicId } answer', async () => {
      mockFormRepo.findOne.mockResolvedValue(fileForm);
      await expect(
        service.submitAsPublic('form-1', { f1: validAnswer }),
      ).resolves.toBeDefined();
    });

    it('rejects a FILE answer that is a bare string, not an object', async () => {
      mockFormRepo.findOne.mockResolvedValue(fileForm);
      await expect(
        service.submitAsPublic('form-1', { f1: 'not-an-object' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a FILE answer missing publicId', async () => {
      mockFormRepo.findOne.mockResolvedValue(fileForm);
      await expect(
        service.submitAsPublic('form-1', {
          f1: { url: 'https://cdn.example.com/f.pdf' },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deletes the claimed attachment tracking row on a successful save', async () => {
      mockFormRepo.findOne.mockResolvedValue(fileForm);
      await service.submitAsPublic('form-1', { f1: validAnswer });
      expect(mockAttachmentRepo.delete).toHaveBeenCalledWith({
        publicId: expect.anything(),
      });
    });

    it('does not touch the attachment repo when no FILE field was answered', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...fileForm,
        fields: [{ ...fileForm.fields[0], required: false }],
      });
      await service.submitAsPublic('form-1', {});
      expect(mockAttachmentRepo.delete).not.toHaveBeenCalled();
    });

    it('still saves the submission even if attachment cleanup fails', async () => {
      mockFormRepo.findOne.mockResolvedValue(fileForm);
      mockAttachmentRepo.delete.mockRejectedValueOnce(new Error('db down'));
      const result = await service.submitAsPublic('form-1', {
        f1: validAnswer,
      });
      expect(result.submissionId).toBe('sub-1');
    });
  });
});
