import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Form } from '../entity/form.entity';
import { FormField } from '../entity/form-field.entity';
import { FormSubmission } from '../entity/form-submission.entity';
import { Member } from '../../member/entity/member.entity';
import {
  FIELD_TYPES_REQUIRING_OPTIONS,
  FormFieldAutoFill,
  FormVisibility,
} from '../enum/form.enum';

@Injectable()
export class FormSubmissionService {
  constructor(
    @InjectRepository(Form)
    private readonly formRepo: Repository<Form>,
    @InjectRepository(FormSubmission)
    private readonly submissionRepo: Repository<FormSubmission>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
  ) {}

  async listForMembers(eventId?: string): Promise<Form[]> {
    const where: Record<string, unknown> = {
      isActive: true,
      visibility: In([FormVisibility.MEMBERS, FormVisibility.PUBLIC]),
    };
    if (eventId) where.event = { id: eventId };
    return this.formRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async getForMember(
    id: string,
    memberId: string,
  ): Promise<{ form: Form; suggestedValues: Record<string, string> }> {
    const form = await this.formRepo.findOneBy({
      id,
      isActive: true,
    });
    if (
      !form ||
      ![FormVisibility.MEMBERS, FormVisibility.PUBLIC].includes(form.visibility)
    ) {
      throw new NotFoundException('Form not found');
    }

    const member = await this.memberRepo.findOneBy({ id: memberId });
    const suggestedValues: Record<string, string> = {};
    if (member) {
      for (const field of form.fields) {
        const value = this.resolveAutoFillValue(field.autoFillKey, member);
        if (value) suggestedValues[field.id] = value;
      }
    }

    return { form, suggestedValues };
  }

  async getForPublic(id: string): Promise<Form> {
    const form = await this.formRepo.findOneBy({
      id,
      isActive: true,
      visibility: FormVisibility.PUBLIC,
    });
    if (!form) throw new NotFoundException('Form not found');
    return form;
  }

  async submitAsMember(
    formId: string,
    memberId: string,
    answers: Record<string, unknown>,
  ): Promise<FormSubmission> {
    const form = await this.getVisibleFormOrThrow(formId, [
      FormVisibility.MEMBERS,
      FormVisibility.PUBLIC,
    ]);
    this.validateAnswers(form.fields, answers);
    return this.submissionRepo.save(
      this.submissionRepo.create({
        form: { id: form.id } as Form,
        member: { id: memberId } as Member,
        answers,
      }),
    );
  }

  async submitAsPublic(
    formId: string,
    answers: Record<string, unknown>,
  ): Promise<FormSubmission> {
    const form = await this.getVisibleFormOrThrow(formId, [
      FormVisibility.PUBLIC,
    ]);
    this.validateAnswers(form.fields, answers);
    return this.submissionRepo.save(
      this.submissionRepo.create({
        form: { id: form.id } as Form,
        member: null,
        answers,
      }),
    );
  }

  private async getVisibleFormOrThrow(
    id: string,
    allowedVisibilities: FormVisibility[],
  ): Promise<Form> {
    const form = await this.formRepo.findOneBy({ id, isActive: true });
    if (!form || !allowedVisibilities.includes(form.visibility)) {
      throw new NotFoundException('Form not found');
    }
    return form;
  }

  private validateAnswers(
    fields: FormField[],
    answers: Record<string, unknown>,
  ): void {
    for (const field of fields) {
      const value = answers[field.id];
      const isEmpty =
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0);

      if (field.required && isEmpty) {
        throw new BadRequestException(`"${field.label}" is required`);
      }
      if (isEmpty) continue;

      if (FIELD_TYPES_REQUIRING_OPTIONS.has(field.fieldType) && field.options) {
        const submitted = Array.isArray(value) ? value : [value];
        const invalid = submitted.some(
          (v) => typeof v !== 'string' || !field.options!.includes(v),
        );
        if (invalid) {
          throw new BadRequestException(
            `"${field.label}" must be one of the provided options`,
          );
        }
      }
    }
  }

  private resolveAutoFillValue(
    key: FormFieldAutoFill | null,
    member: Member,
  ): string | null {
    switch (key) {
      case FormFieldAutoFill.FIRST_NAME:
        return member.firstname;
      case FormFieldAutoFill.LAST_NAME:
        return member.lastname;
      case FormFieldAutoFill.EMAIL:
        return member.email;
      case FormFieldAutoFill.PHONE_NUMBER:
        return member.phoneNumber ?? null;
      default:
        return null;
    }
  }
}
