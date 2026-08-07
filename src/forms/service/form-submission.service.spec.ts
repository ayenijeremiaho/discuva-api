import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FormSubmissionService } from './form-submission.service';
import { Form } from '../entity/form.entity';
import { FormSubmission } from '../entity/form-submission.entity';
import { Member } from '../../member/entity/member.entity';
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

describe('FormSubmissionService', () => {
  let service: FormSubmissionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormSubmissionService,
        { provide: getRepositoryToken(Form), useValue: mockFormRepo },
        {
          provide: getRepositoryToken(FormSubmission),
          useValue: mockSubmissionRepo,
        },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
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
});
