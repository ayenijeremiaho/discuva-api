import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FormSubmissionService } from './form-submission.service';
import { Form } from '../entity/form.entity';
import { FormSubmission } from '../entity/form-submission.entity';
import { Member } from '../../member/entity/member.entity';
import { FollowUpService } from '../../follow-up/service/follow-up.service';
import { GroupService } from '../../group/service/group.service';
import {
  FormFieldAutoFill,
  FormFieldType,
  FormVisibility,
} from '../enum/form.enum';

const mockFormRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
};
const mockSubmissionRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'sub-1', ...v })),
};
const mockMemberRepo = {
  findOneBy: jest.fn(),
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

describe('FormSubmissionService', () => {
  let service: FormSubmissionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFollowUpService.createFirstTimerFromPublicForm.mockResolvedValue({
      id: 'ft-1',
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormSubmissionService,
        { provide: getRepositoryToken(Form), useValue: mockFormRepo },
        {
          provide: getRepositoryToken(FormSubmission),
          useValue: mockSubmissionRepo,
        },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        { provide: FollowUpService, useValue: mockFollowUpService },
        { provide: GroupService, useValue: mockGroupService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get(FormSubmissionService);
  });

  describe('getForMember', () => {
    it('404s on an inactive or non-member-visible form', async () => {
      mockFormRepo.findOneBy.mockResolvedValue(null);
      await expect(service.getForMember('form-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('pre-fills suggested values from the member profile for auto-fill fields', async () => {
      mockFormRepo.findOneBy.mockResolvedValue({
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
      mockFormRepo.findOneBy.mockResolvedValue(null);
      await expect(service.getForPublic('form-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockFormRepo.findOneBy).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: FormVisibility.PUBLIC }),
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
      mockFormRepo.findOneBy.mockResolvedValue(formWithRequiredField);
      await expect(service.submitAsPublic('form-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a DROPDOWN answer outside the configured options', async () => {
      mockFormRepo.findOneBy.mockResolvedValue({
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
      mockFormRepo.findOneBy.mockResolvedValue(formWithRequiredField);
      const result = await service.submitAsPublic('form-1', {
        f1: 'Jane Doe',
      });
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ member: null, answers: { f1: 'Jane Doe' } }),
      );
      expect(result.submissionId).toBe('sub-1');
    });

    it('saves a valid member submission with memberId from the token, not the body', async () => {
      mockFormRepo.findOneBy.mockResolvedValue({
        ...formWithRequiredField,
        visibility: FormVisibility.MEMBERS,
      });
      await service.submitAsMember('form-1', 'member-42', { f1: 'Jane Doe' });
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ member: { id: 'member-42' } }),
      );
    });

    it('rejects a member submission to a form that is not member-visible', async () => {
      mockFormRepo.findOneBy.mockResolvedValue(null);
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
      mockFormRepo.findOneBy.mockResolvedValue(adminOnlyForm);
      const result = await service.submitAsAdmin('form-1', { f1: 'Baby Jane' });
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ member: null, answers: { f1: 'Baby Jane' } }),
      );
      expect(result.submissionId).toBe('sub-1');
    });

    it('links the submission to the given member when memberId is provided', async () => {
      mockFormRepo.findOneBy.mockResolvedValue(adminOnlyForm);
      await service.submitAsAdmin('form-1', { f1: 'Baby Jane' }, 'member-42');
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ member: { id: 'member-42' } }),
      );
    });

    it('works against a MEMBERS-visibility form too, not just ADMIN_ONLY', async () => {
      mockFormRepo.findOneBy.mockResolvedValue({
        ...adminOnlyForm,
        visibility: FormVisibility.MEMBERS,
      });
      await expect(
        service.submitAsAdmin('form-1', { f1: 'Baby Jane' }),
      ).resolves.toBeDefined();
    });

    it('404s on an inactive form', async () => {
      mockFormRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.submitAsAdmin('form-1', { f1: 'Baby Jane' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockFormRepo.findOneBy).toHaveBeenCalledWith({
        id: 'form-1',
        isActive: true,
      });
    });

    it('still validates answers against the form fields', async () => {
      mockFormRepo.findOneBy.mockResolvedValue(adminOnlyForm);
      await expect(service.submitAsAdmin('form-1', {})).rejects.toThrow(
        BadRequestException,
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
      mockFormRepo.findOneBy.mockResolvedValue(firstTimerForm);

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
      mockFormRepo.findOneBy.mockResolvedValue(firstTimerForm);

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
      mockFormRepo.findOneBy.mockResolvedValue({
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
      mockFormRepo.findOneBy.mockResolvedValue(firstTimerForm);
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
      mockFormRepo.findOneBy.mockResolvedValue(phoneForm);
      await service.submitAsPublic('form-1', { f1: '08012345678' });
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ answers: { f1: '+2348012345678' } }),
      );
    });

    it('rejects a required phone field that fails to normalize', async () => {
      mockFormRepo.findOneBy.mockResolvedValue(phoneForm);
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
      mockFormRepo.findOneBy.mockResolvedValue(dedupForm);
      await service.submitAsPublic('form-1', { f1: '08012345678' });
      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ dedupValueNormalized: '+2348012345678' }),
      );
    });

    it('translates a unique-constraint violation into a friendly error carrying a distinct code', async () => {
      expect.assertions(2);
      mockFormRepo.findOneBy.mockResolvedValue(dedupForm);
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
      mockFormRepo.findOneBy.mockResolvedValue(dedupForm);
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
      mockFormRepo.findOneBy.mockResolvedValue(nextStepsForm);
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
      mockFormRepo.findOneBy.mockResolvedValue({
        ...nextStepsForm,
        nextStepsField: null,
      });
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps.selectedOption).toBeNull();
    });

    it('returns the general action alongside the selected option when both are configured', async () => {
      mockFormRepo.findOneBy.mockResolvedValue({
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
      mockFormRepo.findOneBy.mockResolvedValue({
        ...nextStepsForm,
        generalActionUrl: 'https://chat.example.com/main-group',
        generalActionLabel: null,
      });
      const result = await service.submitAsPublic('form-1', { f1: 'Choir' });
      expect(result.nextSteps.generalAction).toBeNull();
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
      mockFormRepo.findOneBy.mockResolvedValue(restrictedForm);
      mockGroupService.getMemberIdsForGroup.mockResolvedValue([
        'member-in-group',
      ]);
      await expect(
        service.getForMember('form-1', 'member-outside'),
      ).rejects.toThrow(NotFoundException);
    });

    it('getForMember succeeds for a member inside the audience group', async () => {
      mockFormRepo.findOneBy.mockResolvedValue(restrictedForm);
      mockGroupService.getMemberIdsForGroup.mockResolvedValue([
        'member-in-group',
      ]);
      mockMemberRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.getForMember('form-1', 'member-in-group'),
      ).resolves.toBeDefined();
    });

    it('submitAsMember rejects a member outside the audience group', async () => {
      mockFormRepo.findOneBy.mockResolvedValue(restrictedForm);
      mockGroupService.getMemberIdsForGroup.mockResolvedValue([
        'member-in-group',
      ]);
      await expect(
        service.submitAsMember('form-1', 'member-outside', {}),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
