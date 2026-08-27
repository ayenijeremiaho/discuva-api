import {
  BadRequestException,
  Injectable,
  Logger,
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
import { FollowUpService } from '../../follow-up/service/follow-up.service';
import { CreateFirstTimerDto } from '../../follow-up/dto/create-first-timer.dto';

@Injectable()
export class FormSubmissionService {
  private readonly logger = new Logger(FormSubmissionService.name);

  constructor(
    @InjectRepository(Form)
    private readonly formRepo: Repository<Form>,
    @InjectRepository(FormSubmission)
    private readonly submissionRepo: Repository<FormSubmission>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    private readonly followUpService: FollowUpService,
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
    const saved = await this.submissionRepo.save(
      this.submissionRepo.create({
        form: { id: form.id } as Form,
        member: null,
        answers,
      }),
    );

    if (form.createsFirstTimers) {
      // Deliberately awaited but fault-tolerant: a failure here (e.g. no
      // active Follow-Up team member configured yet) must never surface as
      // an error to an anonymous visitor filling this in from a QR code —
      // their submission is already saved regardless. Logged so the gap is
      // discoverable, not silently lost.
      try {
        await this.followUpService.createFirstTimerFromPublicForm(
          this.buildFirstTimerDto(form.fields, answers),
        );
      } catch (err: unknown) {
        this.logger.error(
          `Failed to auto-create first-timer from form ${form.id} submission ${saved.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }

    return saved;
  }

  // No visibility restriction — an admin can record a submission against
  // any active form regardless of its MEMBERS/PUBLIC/ADMIN_ONLY visibility
  // (e.g. backfilling a MEMBERS-visibility form entry for someone who
  // called in rather than used the app), unlike submitAsMember/submitAsPublic
  // which are each locked to the visibility that makes them reachable at
  // all. memberId is optional — the subject of a pastoral record often has
  // no member account at all (e.g. a newborn being named).
  async submitAsAdmin(
    formId: string,
    answers: Record<string, unknown>,
    memberId?: string,
  ): Promise<FormSubmission> {
    const form = await this.formRepo.findOneBy({ id: formId, isActive: true });
    if (!form) throw new NotFoundException('Form not found');
    this.validateAnswers(form.fields, answers);
    return this.submissionRepo.save(
      this.submissionRepo.create({
        form: { id: form.id } as Form,
        member: memberId ? ({ id: memberId } as Member) : null,
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

  // Reverse of resolveAutoFillValue below — pulls a submitted answer back
  // out by which field carries which autoFillKey, rather than pushing a
  // member's own profile value in. Assumes FormService already enforced
  // that FIRST_NAME/LAST_NAME/PHONE_NUMBER each have exactly one field
  // (createsFirstTimers forms can't be saved otherwise); if more than one
  // field somehow shares a key, the first match wins.
  private buildFirstTimerDto(
    fields: FormField[],
    answers: Record<string, unknown>,
  ): CreateFirstTimerDto {
    const valueFor = (key: FormFieldAutoFill): string | undefined => {
      const field = fields.find((f) => f.autoFillKey === key);
      const value = field ? answers[field.id] : undefined;
      return typeof value === 'string' && value.trim()
        ? value.trim()
        : undefined;
    };

    return {
      firstname: valueFor(FormFieldAutoFill.FIRST_NAME) ?? '',
      lastname: valueFor(FormFieldAutoFill.LAST_NAME) ?? '',
      phone: valueFor(FormFieldAutoFill.PHONE_NUMBER) ?? '',
      email: valueFor(FormFieldAutoFill.EMAIL),
    };
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
