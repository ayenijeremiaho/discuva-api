import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import type { CountryCode } from 'libphonenumber-js';
import { Form } from '../entity/form.entity';
import { FormField } from '../entity/form-field.entity';
import { FormSubmission } from '../entity/form-submission.entity';
import { Member } from '../../member/entity/member.entity';
import {
  FIELD_TYPES_REQUIRING_OPTIONS,
  FormFieldAutoFill,
  FormFieldType,
  FormVisibility,
} from '../enum/form.enum';
import {
  FormSubmitResponseDto,
  PublicFormDto,
  PublicFormFieldDto,
} from '../dto/form.dto';
import { FollowUpService } from '../../follow-up/service/follow-up.service';
import { CreateFirstTimerDto } from '../../follow-up/dto/create-first-timer.dto';
import { GroupService } from '../../group/service/group.service';
import { normalizePhoneNumber } from '../../utility/decorators/normalize-phone.decorator';

@Injectable()
export class FormSubmissionService {
  private readonly logger = new Logger(FormSubmissionService.name);

  // Only used to interpret a LOCAL-format phone number with no country
  // code (e.g. a bare "0801234567") — a number typed with its own country
  // code (leading "+", or a bare international dialing code) is parsed
  // correctly regardless of this default. CURRENCY_LOCALE is a global
  // per-deployment env var (not per-tenant), same convention already used
  // for currency/date formatting elsewhere (TitheService, PdfService,
  // EventReminderService) — this platform is multi-country, so this is a
  // configurable default, not a Nigeria-only assumption.
  private readonly defaultPhoneRegion: CountryCode;

  constructor(
    @InjectRepository(Form)
    private readonly formRepo: Repository<Form>,
    @InjectRepository(FormSubmission)
    private readonly submissionRepo: Repository<FormSubmission>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    private readonly followUpService: FollowUpService,
    private readonly groupService: GroupService,
    private readonly config: ConfigService,
  ) {
    const locale = this.config.get<string>('CURRENCY_LOCALE', 'en-NG');
    this.defaultPhoneRegion = (locale.split('-')[1]?.toUpperCase() ??
      'NG') as CountryCode;
  }

  async listForMembers(
    eventId: string | undefined,
    memberId: string,
  ): Promise<Form[]> {
    const qb = this.formRepo
      .createQueryBuilder('form')
      .where('form.isActive = true')
      .andWhere('form.visibility IN (:...visibilities)', {
        visibilities: [FormVisibility.MEMBERS, FormVisibility.PUBLIC],
      })
      .andWhere(
        `(form.visibility != :members OR form.audience_group_id IS NULL OR EXISTS (
           SELECT 1 FROM group_members gm
           WHERE gm.group_id = form.audience_group_id AND gm.member_id = :memberId
         ))`,
        { members: FormVisibility.MEMBERS, memberId },
      )
      .orderBy('form.createdAt', 'DESC');
    if (eventId) qb.andWhere('form.event = :eventId', { eventId });
    return qb.getMany();
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
    if (form.visibility === FormVisibility.MEMBERS && form.audienceGroup) {
      const allowedIds = await this.groupService.getMemberIdsForGroup(
        form.audienceGroup.id,
      );
      if (!allowedIds.includes(memberId)) {
        throw new NotFoundException('Form not found');
      }
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

  async getForPublic(id: string): Promise<PublicFormDto> {
    const form = await this.formRepo.findOneBy({
      id,
      isActive: true,
      visibility: FormVisibility.PUBLIC,
    });
    if (!form) throw new NotFoundException('Form not found');
    return this.toPublicDto(form);
  }

  async submitAsMember(
    formId: string,
    memberId: string,
    answers: Record<string, unknown>,
  ): Promise<FormSubmitResponseDto> {
    const form = await this.getVisibleFormOrThrow(formId, [
      FormVisibility.MEMBERS,
      FormVisibility.PUBLIC,
    ]);
    if (form.visibility === FormVisibility.MEMBERS && form.audienceGroup) {
      const allowedIds = await this.groupService.getMemberIdsForGroup(
        form.audienceGroup.id,
      );
      if (!allowedIds.includes(memberId)) {
        throw new NotFoundException('Form not found');
      }
    }
    const normalized = this.normalizeAnswers(form.fields, answers);
    this.validateAnswers(form.fields, normalized);
    const saved = await this.saveSubmission(form, normalized, {
      id: memberId,
    } as Member);
    return this.buildSubmitResponse(form, normalized, saved.id);
  }

  async submitAsPublic(
    formId: string,
    answers: Record<string, unknown>,
  ): Promise<FormSubmitResponseDto> {
    const form = await this.getVisibleFormOrThrow(formId, [
      FormVisibility.PUBLIC,
    ]);
    const normalized = this.normalizeAnswers(form.fields, answers);
    this.validateAnswers(form.fields, normalized);
    const saved = await this.saveSubmission(form, normalized, null);

    if (form.createsFirstTimers) {
      // Deliberately awaited but fault-tolerant: a failure here (e.g. no
      // active Follow-Up team member configured yet) must never surface as
      // an error to an anonymous visitor filling this in from a QR code —
      // their submission is already saved regardless. Logged so the gap is
      // discoverable, not silently lost.
      try {
        await this.followUpService.createFirstTimerFromPublicForm(
          this.buildFirstTimerDto(form.fields, normalized),
        );
      } catch (err: unknown) {
        this.logger.error(
          `Failed to auto-create first-timer from form ${form.id} submission ${saved.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }

    return this.buildSubmitResponse(form, normalized, saved.id);
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
  ): Promise<FormSubmitResponseDto> {
    const form = await this.formRepo.findOneBy({ id: formId, isActive: true });
    if (!form) throw new NotFoundException('Form not found');
    const normalized = this.normalizeAnswers(form.fields, answers);
    this.validateAnswers(form.fields, normalized);
    const saved = await this.saveSubmission(
      form,
      normalized,
      memberId ? ({ id: memberId } as Member) : null,
    );
    return this.buildSubmitResponse(form, normalized, saved.id);
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

  // Runs every PHONE-type field's submitted value through
  // normalizePhoneNumber, writing the canonical form back into a copy of
  // `answers` — so exports, analytics, and dedup all ever see one shape
  // for the same real number, never whatever variant a visitor happened to
  // type. Throws if a *required* PHONE field doesn't normalize; an
  // optional one that fails to normalize is just left blank rather than
  // rejected outright (mirrors validateAnswers' existing required-only
  // strictness).
  private normalizeAnswers(
    fields: FormField[],
    answers: Record<string, unknown>,
  ): Record<string, unknown> {
    const normalized = { ...answers };
    for (const field of fields) {
      if (field.fieldType !== FormFieldType.PHONE) continue;
      const raw = normalized[field.id];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const value = normalizePhoneNumber(raw, this.defaultPhoneRegion);
      if (value) {
        normalized[field.id] = value;
      } else if (field.required) {
        throw new BadRequestException(
          `"${field.label}" must be a valid phone number`,
        );
      }
    }
    return normalized;
  }

  private computeDedupValue(
    dedupField: FormField,
    answers: Record<string, unknown>,
  ): string | null {
    const raw = answers[dedupField.id];
    if (typeof raw !== 'string' || !raw.trim()) return null;
    if (dedupField.fieldType === FormFieldType.PHONE) {
      return normalizePhoneNumber(raw, this.defaultPhoneRegion);
    }
    return raw.trim().toLowerCase();
  }

  private async saveSubmission(
    form: Form,
    answers: Record<string, unknown>,
    member: Member | null,
  ): Promise<FormSubmission> {
    const dedupValueNormalized = form.dedupField
      ? this.computeDedupValue(form.dedupField, answers)
      : null;
    try {
      return await this.submissionRepo.save(
        this.submissionRepo.create({
          form: { id: form.id } as Form,
          member,
          answers,
          dedupValueNormalized,
        }),
      );
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === '23505') {
        // Structured code (not just a message string) so the fill page can
        // render a distinct "you're already registered" screen instead of
        // a generic error banner — the global exception filter spreads
        // every extra key on the thrown body into the response.
        throw new BadRequestException({
          message: "You've already submitted this form.",
          code: 'DUPLICATE_SUBMISSION',
        });
      }
      throw err;
    }
  }

  private buildSubmitResponse(
    form: Form,
    answers: Record<string, unknown>,
    submissionId: string,
  ): FormSubmitResponseDto {
    let selectedOption: FormSubmitResponseDto['nextSteps']['selectedOption'] =
      null;
    if (form.nextStepsField) {
      const value = answers[form.nextStepsField.id];
      if (typeof value === 'string' && value) {
        const meta = form.nextStepsField.optionMetadata?.[value];
        selectedOption = {
          value,
          url: meta?.url ?? null,
          description: meta?.description ?? null,
        };
      }
    }
    return {
      submissionId,
      nextSteps: {
        message: form.postSubmitMessage ?? null,
        generalAction:
          form.generalActionUrl && form.generalActionLabel
            ? { label: form.generalActionLabel, url: form.generalActionUrl }
            : null,
        selectedOption,
      },
    };
  }

  private toPublicDto(form: Form): PublicFormDto {
    return {
      id: form.id,
      title: form.title,
      description: form.description,
      coverImageUrl: form.coverImageUrl,
      logoUrl: form.logoUrl,
      fields: [...form.fields]
        .sort((a, b) => a.order - b.order)
        .map((f): PublicFormFieldDto => ({
          id: f.id,
          label: f.label,
          description: f.description,
          fieldType: f.fieldType,
          required: f.required,
          options: f.options,
          order: f.order,
          autoFillKey: f.autoFillKey,
        })),
    };
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
