import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FormSubmissionService } from './form-submission.service';
import { Form } from '../entity/form.entity';
import { FormSubmission } from '../entity/form-submission.entity';
import { Member } from '../../member/entity/member.entity';
import { FollowUpService } from '../../follow-up/service/follow-up.service';
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
      expect(result.id).toBe('sub-1');
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
      expect(result.id).toBe('sub-1');
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

      expect(result.id).toBe('sub-1');
    });
  });
});
