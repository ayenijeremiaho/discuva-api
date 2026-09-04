import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import 'multer';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import type { CountryCode } from 'libphonenumber-js';
import { Form } from '../entity/form.entity';
import { FormField } from '../entity/form-field.entity';
import { FormSubmission } from '../entity/form-submission.entity';
import { FormFieldAttachment } from '../entity/form-field-attachment.entity';
import { Member } from '../../member/entity/member.entity';
import {
  FIELD_TYPES_REQUIRING_OPTIONS,
  FormFieldAutoFill,
  FormFieldType,
  FormFieldVisibilityOperator,
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
import {
  isValidDateString,
  isValidEmail,
  isValidNumber,
} from '../../utility/decorators/form-answer-validators';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategorySettingsService } from '../../email-category-settings/service/email-category-settings.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

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
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    @InjectRepository(FormFieldAttachment)
    private readonly attachmentRepo: Repository<FormFieldAttachment>,
    private readonly followUpService: FollowUpService,
    private readonly groupService: GroupService,
    private readonly config: ConfigService,
    private readonly utilityService: UtilityService,
    private readonly emailCategorySettingsService: EmailCategorySettingsService,
    private readonly cloudinaryService: CloudinaryService,
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
    const form = await this.formRepo.findOne({
      where: { id, isActive: true },
      order: { fields: { order: 'ASC' } },
    });
    if (
      !form ||
      ![FormVisibility.MEMBERS, FormVisibility.PUBLIC].includes(form.visibility)
    ) {
      throw new NotFoundException('Form not found');
    }
    await this.assertMemberInAudienceGroup(form, memberId);

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
    const form = await this.formRepo.findOne({
      where: { id, isActive: true, visibility: FormVisibility.PUBLIC },
      order: { fields: { order: 'ASC' } },
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
    await this.assertMemberInAudienceGroup(form, memberId);
    const normalized = this.normalizeAnswers(form.fields, answers);
    this.validateAnswers(form.fields, normalized);
    const cleaned = this.stripHiddenAnswers(form.fields, normalized);
    const saved = await this.saveSubmission(form, cleaned, {
      id: memberId,
    } as Member);
    this.notifyAdmins(form, saved.id).catch((err: unknown) =>
      this.logger.error(
        `Failed to notify admins of form ${form.id} submission ${saved.id}`,
        err instanceof Error ? err.stack : err,
      ),
    );
    return this.buildSubmitResponse(form, cleaned, saved.id);
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
    const cleaned = this.stripHiddenAnswers(form.fields, normalized);
    const saved = await this.saveSubmission(form, cleaned, null);

    this.notifyAdmins(form, saved.id).catch((err: unknown) =>
      this.logger.error(
        `Failed to notify admins of form ${form.id} submission ${saved.id}`,
        err instanceof Error ? err.stack : err,
      ),
    );

    if (form.createsFirstTimers) {
      // Deliberately awaited but fault-tolerant: a failure here (e.g. no
      // active Follow-Up team member configured yet) must never surface as
      // an error to an anonymous visitor filling this in from a QR code —
      // their submission is already saved regardless. Logged so the gap is
      // discoverable, not silently lost.
      try {
        await this.followUpService.createFirstTimerFromPublicForm(
          this.buildFirstTimerDto(form.fields, cleaned),
        );
      } catch (err: unknown) {
        this.logger.error(
          `Failed to auto-create first-timer from form ${form.id} submission ${saved.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }

    return this.buildSubmitResponse(form, cleaned, saved.id);
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
    const form = await this.formRepo.findOne({
      where: { id: formId, isActive: true },
      order: { fields: { order: 'ASC' } },
    });
    if (!form) throw new NotFoundException('Form not found');
    const normalized = this.normalizeAnswers(form.fields, answers);
    this.validateAnswers(form.fields, normalized);
    // Deliberately no stripHiddenAnswers pass here, unlike the member/
    // public paths — the admin's own record-entry UI shows every field
    // unconditionally, ignoring visibilityRule entirely, so an answer
    // reaching here is always something an admin actually saw and typed,
    // never a stale leftover from a field that went hidden underneath
    // them.
    const saved = await this.saveSubmission(
      form,
      normalized,
      memberId ? ({ id: memberId } as Member) : null,
    );
    return this.buildSubmitResponse(form, normalized, saved.id);
  }

  // Powers the member fill page's "you already submitted — edit it?" flow,
  // reached from the DUPLICATE_SUBMISSION error saveSubmission throws.
  // Public/anonymous submissions are never reachable here — they carry no
  // member identity to look one up by, and there's no login for an
  // anonymous visitor to come back through anyway. `editable` reflects
  // Form.editableAfterSubmit so the frontend can show a read-only view
  // instead of an edit link when an admin has turned editing off, without
  // a second round trip. If more than one submission exists for the same
  // member+form (only possible when the form has no dedupField — nothing
  // stops a repeat submission in that case), the most recent one wins.
  // ADMIN_ONLY forms are excluded even if the caller happens to be the
  // memberId attached to one of their submissions (e.g. a baptism record an
  // admin filed on the member's behalf via submitAsAdmin) — those forms
  // have no member-facing fill surface at all, and a subject shouldn't be
  // able to fetch or edit that record just because they're linked to it.
  async getMySubmission(
    formId: string,
    memberId: string,
  ): Promise<{
    submissionId: string;
    answers: Record<string, unknown>;
    editable: boolean;
  }> {
    const form = await this.formRepo.findOne({
      where: { id: formId, isActive: true },
      order: { fields: { order: 'ASC' } },
    });
    if (!form || form.visibility === FormVisibility.ADMIN_ONLY) {
      throw new NotFoundException('Form not found');
    }
    const submission = await this.submissionRepo.findOne({
      where: { form: { id: formId }, member: { id: memberId } },
      order: { createdAt: 'DESC' },
    });
    if (!submission) throw new NotFoundException('No submission found');
    return {
      submissionId: submission.id,
      answers: submission.answers,
      editable: form.editableAfterSubmit,
    };
  }

  // Runs the same normalize/validate pipeline a fresh submit does (so 4a's
  // bounds and 4c's visibility-aware required-skipping both apply), but
  // never calls notifyAdmins — an edit isn't a new-submission event. The
  // dedup value is only recomputed/rewritten when it actually changed, so
  // an edit that leaves the dedup field untouched doesn't even attempt a
  // write to that column. A `23505` conflict here means the *new* value
  // collides with a *different* submission's — reported the same
  // DUPLICATE_SUBMISSION way saveSubmission's own does.
  async updateSubmission(
    submissionId: string,
    memberId: string,
    answers: Record<string, unknown>,
  ): Promise<FormSubmitResponseDto> {
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId },
      relations: ['form', 'member'],
    });
    if (!submission || submission.member?.id !== memberId) {
      throw new NotFoundException('Submission not found');
    }

    const form = await this.formRepo.findOne({
      where: { id: submission.form.id, isActive: true },
      order: { fields: { order: 'ASC' } },
    });
    if (!form || form.visibility === FormVisibility.ADMIN_ONLY) {
      throw new NotFoundException('Form not found');
    }
    if (!form.editableAfterSubmit) {
      throw new BadRequestException(
        'This form no longer accepts changes to your response',
      );
    }

    const normalized = this.normalizeAnswers(form.fields, answers);
    this.validateAnswers(form.fields, normalized);
    const cleaned = this.stripHiddenAnswers(form.fields, normalized);

    const dedupValueNormalized = form.dedupField
      ? this.computeDedupValue(form.dedupField, cleaned)
      : null;
    submission.answers = cleaned;
    if (dedupValueNormalized !== submission.dedupValueNormalized) {
      submission.dedupValueNormalized = dedupValueNormalized;
    }

    try {
      const saved = await this.submissionRepo.save(submission);
      // Not fire-and-forget — same reasoning as saveSubmission's own call:
      // a silent failure here would let a re-uploaded file's tracking row
      // survive to the orphan sweep and delete an asset this edit still
      // references. Note: the file being *replaced* (the old answer's own
      // upload) isn't cleaned up here — its tracking row was already
      // deleted when the original submission first succeeded, so there's
      // no resourceType available to delete it by at edit time. A known,
      // narrow gap (an edited-away FILE answer leaks its old asset) rather
      // than a speculative fix for a rare case.
      await this.cleanupClaimedAttachments(form.fields, cleaned);
      return this.buildSubmitResponse(form, cleaned, saved.id);
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === '23505') {
        throw new BadRequestException({
          message: 'Another submission already uses that value.',
          code: 'DUPLICATE_SUBMISSION',
        });
      }
      throw err;
    }
  }

  private async getVisibleFormOrThrow(
    id: string,
    allowedVisibilities: FormVisibility[],
  ): Promise<Form> {
    const form = await this.formRepo.findOne({
      where: { id, isActive: true },
      order: { fields: { order: 'ASC' } },
    });
    if (!form || !allowedVisibilities.includes(form.visibility)) {
      throw new NotFoundException('Form not found');
    }
    return form;
  }

  // Shared by getForMember/submitAsMember/uploadAttachment — a no-op unless
  // the form is both MEMBERS-visibility and actually restricted to a
  // Contact List (most MEMBERS forms aren't).
  private async assertMemberInAudienceGroup(
    form: Form,
    memberId: string,
  ): Promise<void> {
    if (form.visibility !== FormVisibility.MEMBERS || !form.audienceGroup) {
      return;
    }
    const allowedIds = await this.groupService.getMemberIdsForGroup(
      form.audienceGroup.id,
    );
    if (!allowedIds.includes(memberId)) {
      throw new NotFoundException('Form not found');
    }
  }

  // Upload-then-reference: a FILE field's answer is the { url, publicId }
  // this returns, not the file itself — the 3 submit endpoints stay pure
  // JSON. `allowedVisibilities` is the same per-caller allowlist
  // getVisibleFormOrThrow already uses (member/public/admin each pass their
  // own), so uploading to a field is gated by exactly the same
  // authorization a submission to that form would be. `memberId` is only
  // passed by the member-facing caller — admin/public uploads skip the
  // audience-group check (matching submitAsAdmin's own unrestricted access,
  // and public forms have no member identity to check against anyway).
  async uploadAttachment(
    formId: string,
    fieldId: string,
    file: Express.Multer.File,
    allowedVisibilities: FormVisibility[],
    memberId?: string,
  ): Promise<{ url: string; publicId: string }> {
    const form = await this.getVisibleFormOrThrow(formId, allowedVisibilities);
    if (memberId) {
      await this.assertMemberInAudienceGroup(form, memberId);
    }
    const field = form.fields.find((f) => f.id === fieldId);
    if (field?.fieldType !== FormFieldType.FILE) {
      throw new BadRequestException('This field does not accept file uploads');
    }

    const uploaded = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      'form-submissions',
      undefined,
      file.mimetype,
    );
    await this.attachmentRepo.save(
      this.attachmentRepo.create({
        formId,
        fieldId,
        publicId: uploaded.publicId,
        url: uploaded.secureUrl,
        resourceType: uploaded.resourceType,
      }),
    );
    return { url: uploaded.secureUrl, publicId: uploaded.publicId };
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

  // Run AFTER validateAnswers, never before — validateAnswers must see
  // every raw submitted value (including a hidden field's stale leftover
  // one) to preserve its documented "each field's visibility is evaluated
  // independently against the raw answers" semantics; this pass only
  // decides what actually gets persisted. The member/public fill UIs only
  // filter which fields *render* when a prior answer hides one — they
  // never clear that field's own local edit state, so a value entered
  // before it went hidden is still sent in the submit payload. Left
  // alone, that stale value would be saved verbatim into the submission
  // record, polluting CSV export and FormService.getAnalytics with an
  // answer the submitter never actually saw the field to confirm. Every
  // field's visibility is evaluated against the same fixed `answers`
  // snapshot (never the partially-stripped `cleaned` result), so which
  // order fields happen to be stripped in can't change another field's
  // own hidden/visible determination.
  private stripHiddenAnswers(
    fields: FormField[],
    answers: Record<string, unknown>,
  ): Record<string, unknown> {
    const cleaned = { ...answers };
    for (const field of fields) {
      if (field.visibilityRule && !this.isFieldVisible(field, answers)) {
        delete cleaned[field.id];
      }
    }
    return cleaned;
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

  // Modeled on IncidentReportService.notifyAdmins. Gated by BOTH the form's
  // own opt-in AND the tenant-wide category toggle (defense-in-depth, same
  // as every other EmailCategory) — checked here rather than left entirely
  // to EmailQueueService so a disabled form never even queries the Admin
  // table. Called fire-and-forget from submitAsMember/submitAsPublic only.
  private async notifyAdmins(form: Form, submissionId: string): Promise<void> {
    if (!form.notifyOnSubmission) return;
    const categoryEnabled = await this.emailCategorySettingsService.isEnabled(
      EmailCategory.FORM_SUBMISSION,
    );
    if (!categoryEnabled) return;

    const admins = await this.adminRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.member', 'm')
      .leftJoinAndSelect('a.adminRole', 'role')
      .where('a.isActive = true')
      .getMany();

    const recipients = admins
      .filter((a) =>
        a.adminRole?.permissions?.includes(AdminPermission.FORMS_WRITE),
      )
      .map((a) => a.member?.email)
      .filter((e): e is string => !!e);

    for (const email of recipients) {
      this.utilityService.sendEmailWithTemplate(
        email,
        `New Submission: ${form.title}`,
        'form-submission-new',
        { formTitle: form.title, submissionId },
        undefined,
        EmailCategory.FORM_SUBMISSION,
      );
    }
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
      const saved = await this.submissionRepo.save(
        this.submissionRepo.create({
          form: { id: form.id } as Form,
          member,
          answers,
          dedupValueNormalized,
        }),
      );
      await this.cleanupClaimedAttachments(form.fields, answers);
      return saved;
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

  // Deletes the FormFieldAttachment tracking row for every FILE answer this
  // submission actually references, so FormAttachmentCleanupScheduler's
  // sweep never touches a Cloudinary asset a real submission still relies
  // on. Awaited (not fire-and-forget, unlike notifyAdmins) — letting this
  // silently fail leaves the row for the sweep to eventually delete out
  // from under a saved submission. A failure here is logged but never
  // fails the submission itself, since the file staying "at risk" for one
  // sweep cycle is a smaller cost than losing an otherwise-successful save.
  private async cleanupClaimedAttachments(
    fields: FormField[],
    answers: Record<string, unknown>,
  ): Promise<void> {
    const publicIds = fields
      .filter((f) => f.fieldType === FormFieldType.FILE)
      .map((f) => answers[f.id])
      .filter(
        (v): v is { publicId: string } =>
          !!v &&
          typeof v === 'object' &&
          typeof (v as { publicId?: unknown }).publicId === 'string',
      )
      .map((v) => v.publicId);
    if (!publicIds.length) return;

    try {
      await this.attachmentRepo.delete({ publicId: In(publicIds) });
    } catch (err: unknown) {
      this.logger.error(
        'Failed to clean up claimed form attachment tracking rows',
        err instanceof Error ? err.stack : err,
      );
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
    const { message, generalAction } = this.resolvePostSubmitContent(
      form,
      answers,
    );
    return {
      submissionId,
      nextSteps: { message, generalAction, selectedOption },
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
          pageIndex: f.pageIndex,
          autoFillKey: f.autoFillKey,
          minValue: f.minValue,
          maxValue: f.maxValue,
          minLength: f.minLength,
          maxLength: f.maxLength,
          minSelections: f.minSelections,
          maxSelections: f.maxSelections,
          validationRegex: f.validationRegex,
          validationMessage: f.validationMessage,
          visibilityRule: f.visibilityRule,
        })),
    };
  }

  private validateAnswers(
    fields: FormField[],
    answers: Record<string, unknown>,
  ): void {
    for (const field of fields) {
      // Evaluated before the required check — a conditionally-hidden field
      // must never block submission, regardless of what the client
      // rendered, and none of its other checks apply to an answer the
      // visitor was never shown the field to give.
      if (!this.isFieldVisible(field, answers)) continue;

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

      this.validateFieldOptions(field, value);
      this.validateFieldFormat(field, value);
      this.validateFieldBounds(field, value);
      this.validateFieldPattern(field, value);
    }
  }

  // Same evaluation logic the member/public fill UIs run client-side
  // (form-fill-fields.tsx's isFieldVisible) — duplicated rather than
  // shared across the api/frontend repo boundary, kept simple and small
  // enough that drift risk is low. No cycle detection: each field's
  // visibility is evaluated independently against the submitted answers,
  // never against another field's own computed visibility, so a rule
  // chain (or even an accidental cycle) can't recurse.
  private isFieldVisible(
    field: FormField,
    answers: Record<string, unknown>,
  ): boolean {
    if (!field.visibilityRule) return true;
    return this.evaluateCondition(field.visibilityRule, answers);
  }

  // Shared by isFieldVisible (FormField.visibilityRule, a single
  // condition) and resolvePostSubmitOutcome (Form.postSubmitOutcomes,
  // several ANDed conditions per outcome) — both are the exact same
  // {fieldId, operator, value} shape evaluated against the submitted
  // answers the exact same way.
  private evaluateCondition(
    condition: {
      fieldId: string;
      operator: FormFieldVisibilityOperator;
      value: string;
    },
    answers: Record<string, unknown>,
  ): boolean {
    const { fieldId, operator, value } = condition;
    const actual = answers[fieldId];

    if (operator === FormFieldVisibilityOperator.INCLUDES) {
      if (Array.isArray(actual)) return actual.includes(value);
      return typeof actual === 'string' && actual.includes(value);
    }

    // equals/notEquals only make sense against a scalar answer — an array
    // (CHECKBOX) or object (FILE) answer is never sensibly "equal" to a
    // typed string, rather than falling back to a meaningless
    // Object-stringified comparison.
    const isScalar =
      actual === null || actual === undefined || typeof actual !== 'object';
    const matches = isScalar && String(actual ?? '') === value;
    return operator === FormFieldVisibilityOperator.NOT_EQUALS
      ? !matches
      : matches;
  }

  // First outcome (in array order) whose conditions ALL match the
  // submitted answers wins — null when none match (or none are
  // configured), letting the caller fall back to the form's own static
  // postSubmitMessage/generalActionUrl/generalActionLabel unchanged. An
  // outcome that matches always fully replaces both message and
  // generalAction together, even when one of them is null on that
  // outcome — a deliberate "this outcome fully determines what's shown"
  // semantics rather than a partial merge with the static fallback.
  // First outcome (in array order) whose conditions ALL match the
  // submitted answers wins. Resolution is per-field, not a paired
  // all-or-nothing swap: a matching outcome's own message/actionUrl/
  // actionLabel are used where it sets them, and each field it *doesn't*
  // set (null) falls back to the form's own static
  // postSubmitMessage/generalActionUrl/generalActionLabel independently —
  // so a rule can condition just the button while leaving the default
  // message alone, or vice versa. This also gives "show the button only
  // for these rules, never otherwise" for free: leave the form's own
  // static action blank (so the no-match fallback is "no button") and
  // only fill in actionUrl/actionLabel on the rules meant to show one —
  // a rule matching with both left blank falls back to that same blank
  // static default, i.e. still no button, not an inherited one from
  // elsewhere.
  private resolvePostSubmitContent(
    form: Form,
    answers: Record<string, unknown>,
  ): {
    message: string | null;
    generalAction: { label: string; url: string } | null;
  } {
    const outcome = form.postSubmitOutcomes?.find((o) =>
      o.conditions.every((c) => this.evaluateCondition(c, answers)),
    );
    const message = outcome?.message ?? form.postSubmitMessage ?? null;
    const actionUrl = outcome?.actionUrl ?? form.generalActionUrl ?? null;
    const actionLabel = outcome?.actionLabel ?? form.generalActionLabel ?? null;
    return {
      message,
      generalAction:
        actionUrl && actionLabel
          ? { label: actionLabel, url: actionUrl }
          : null,
    };
  }

  private validateFieldOptions(field: FormField, value: unknown): void {
    if (!FIELD_TYPES_REQUIRING_OPTIONS.has(field.fieldType) || !field.options) {
      return;
    }
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

  // Per-type format checks (EMAIL/NUMBER/DATE) — split out of validateAnswers
  // so each new type is a flat, independent branch rather than compounding
  // that method's cyclomatic complexity.
  private validateFieldFormat(field: FormField, value: unknown): void {
    switch (field.fieldType) {
      case FormFieldType.EMAIL:
        if (typeof value !== 'string' || !isValidEmail(value)) {
          throw new BadRequestException(
            `"${field.label}" must be a valid email address`,
          );
        }
        break;
      case FormFieldType.NUMBER: {
        const asString = typeof value === 'number' ? String(value) : value;
        if (typeof asString !== 'string' || !isValidNumber(asString)) {
          throw new BadRequestException(
            `"${field.label}" must be a valid number`,
          );
        }
        break;
      }
      case FormFieldType.DATE:
        if (typeof value !== 'string' || !isValidDateString(value)) {
          throw new BadRequestException(
            `"${field.label}" must be a valid date`,
          );
        }
        break;
      case FormFieldType.FILE:
        if (!this.isValidFileAnswer(value)) {
          throw new BadRequestException(
            `"${field.label}" must be a valid file upload`,
          );
        }
        break;
    }
  }

  // Runs after validateFieldFormat, so a NUMBER answer that already failed
  // format validation never reaches here — Number(value) below can assume
  // a well-formed numeric string. Bounds themselves are set at create/
  // update time by FormService.assertValidFieldConstraints, one per
  // fieldType — this only ever checks the pair that applies to `field`.
  private validateFieldBounds(field: FormField, value: unknown): void {
    switch (field.fieldType) {
      case FormFieldType.NUMBER:
        this.assertNumberBounds(field, Number(value));
        break;
      case FormFieldType.TEXT:
      case FormFieldType.TEXTAREA:
        this.assertLengthBounds(
          field,
          typeof value === 'string' ? value.length : 0,
        );
        break;
      case FormFieldType.CHECKBOX:
        this.assertSelectionBounds(
          field,
          Array.isArray(value) ? value.length : 0,
        );
        break;
    }
  }

  private assertNumberBounds(field: FormField, num: number): void {
    if (field.minValue != null && num < field.minValue) {
      throw new BadRequestException(
        `"${field.label}" must be at least ${field.minValue}`,
      );
    }
    if (field.maxValue != null && num > field.maxValue) {
      throw new BadRequestException(
        `"${field.label}" must be at most ${field.maxValue}`,
      );
    }
  }

  private assertLengthBounds(field: FormField, length: number): void {
    if (field.minLength != null && length < field.minLength) {
      throw new BadRequestException(
        `"${field.label}" must be at least ${field.minLength} characters`,
      );
    }
    if (field.maxLength != null && length > field.maxLength) {
      throw new BadRequestException(
        `"${field.label}" must be at most ${field.maxLength} characters`,
      );
    }
  }

  private assertSelectionBounds(field: FormField, count: number): void {
    if (field.minSelections != null && count < field.minSelections) {
      throw new BadRequestException(
        `"${field.label}" needs at least ${field.minSelections} selection(s)`,
      );
    }
    if (field.maxSelections != null && count > field.maxSelections) {
      throw new BadRequestException(
        `"${field.label}" allows at most ${field.maxSelections} selection(s)`,
      );
    }
  }

  // TEXT/TEXTAREA only — validationRegex's syntax was already checked at
  // create/update time by FormService.assertValidFieldPattern, so
  // `new RegExp()` here is never expected to throw against admin-authored
  // data; it's still a plain string field on the entity, not something
  // this method re-validates the shape of.
  private validateFieldPattern(field: FormField, value: unknown): void {
    if (!field.validationRegex) return;
    if (
      field.fieldType !== FormFieldType.TEXT &&
      field.fieldType !== FormFieldType.TEXTAREA
    ) {
      return;
    }
    if (
      typeof value !== 'string' ||
      !new RegExp(field.validationRegex).test(value)
    ) {
      throw new BadRequestException(
        field.validationMessage ||
          `"${field.label}" is not in the required format`,
      );
    }
  }

  // A FILE answer is the { url, publicId } POST forms/.../attachment
  // returned — presence/shape only, no format check the way EMAIL/NUMBER/
  // DATE get, since there's nothing further to validate about it here.
  private isValidFileAnswer(value: unknown): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as { url?: unknown }).url === 'string' &&
      typeof (value as { publicId?: unknown }).publicId === 'string'
    );
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
