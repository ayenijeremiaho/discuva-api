import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Form } from '../entity/form.entity';
import { FormAttempt } from '../entity/form-attempt.entity';
import { FormSubmission } from '../entity/form-submission.entity';
import { Member } from '../../member/entity/member.entity';
import { FormPurpose } from '../enum/form.enum';

@Injectable()
export class FormAttemptService {
  constructor(
    @InjectRepository(Form)
    private readonly formRepo: Repository<Form>,
    @InjectRepository(FormAttempt)
    private readonly attemptRepo: Repository<FormAttempt>,
  ) {}

  // Self-contained entry point for POST forms/member/:id/start — loads and
  // validates the form itself (must be an active, time-limited QUIZ),
  // unlike startOrGetAttempt below which assumes the caller already has a
  // validated Form in hand (FormSubmissionService's submit paths do).
  async startOrGetAttemptById(
    formId: string,
    memberId: string,
  ): Promise<{ startedAt: Date; expiresAt: Date }> {
    const form = await this.formRepo.findOne({
      where: { id: formId, isActive: true },
    });
    if (!form) throw new NotFoundException('Form not found');
    if (form.purpose !== FormPurpose.QUIZ || form.timeLimitMinutes == null) {
      throw new BadRequestException('This form has no timed attempt to start.');
    }
    return this.startOrGetAttempt(form, memberId);
  }

  // Called by POST forms/member/:id/start. Only meaningful for a QUIZ with
  // Form.timeLimitMinutes set — the controller/caller is responsible for
  // checking that before calling this.
  //   - opensAt/closesAt gate STARTING a new attempt, not finishing one
  //     already in progress.
  //   - An unconsumed, unexpired attempt is returned unchanged (idempotent
  //     — a page refresh mid-quiz doesn't reset the clock).
  //   - A consumed (submitted) or expired-unconsumed attempt only allows a
  //     fresh start when Form.oneResponsePerMember is false; otherwise this
  //     is a terminal "already completed" state.
  //   - expiresAt is clamped to the form's own closesAt, if set, so a
  //     personal timer can never outlive the form's own close.
  async startOrGetAttempt(
    form: Form,
    memberId: string,
  ): Promise<{ startedAt: Date; expiresAt: Date }> {
    const now = new Date();
    if (form.opensAt && now < form.opensAt) {
      throw new BadRequestException("This quiz hasn't opened yet.");
    }
    if (form.closesAt && now > form.closesAt) {
      throw new BadRequestException('This quiz has closed.');
    }

    const existing = await this.attemptRepo.findOne({
      where: { form: { id: form.id }, member: { id: memberId } },
      relations: ['submission'],
      order: { startedAt: 'DESC' },
    });

    if (existing && !existing.submission && now <= existing.expiresAt) {
      return { startedAt: existing.startedAt, expiresAt: existing.expiresAt };
    }

    const alreadyAttempted =
      existing && (existing.submission || now > existing.expiresAt);
    if (alreadyAttempted && !form.oneResponsePerMember) {
      // Retakes allowed — a fresh attempt below simply supersedes it.
    } else if (alreadyAttempted) {
      throw new BadRequestException("You've already completed this quiz.");
    }

    const startedAt = now;
    const timerExpiry = new Date(
      startedAt.getTime() + (form.timeLimitMinutes ?? 0) * 60_000,
    );
    const expiresAt =
      form.closesAt && form.closesAt < timerExpiry
        ? form.closesAt
        : timerExpiry;

    const attempt = await this.attemptRepo.save(
      this.attemptRepo.create({
        form: { id: form.id } as Form,
        member: { id: memberId } as Member,
        startedAt,
        expiresAt,
        submission: null,
      }),
    );
    return { startedAt: attempt.startedAt, expiresAt: attempt.expiresAt };
  }

  // For the member "get form for fill" response — the current in-progress
  // (unconsumed) attempt, regardless of whether its clock has already run
  // out, so the frontend can distinguish "no attempt yet" from "you have
  // one, possibly already expired" rather than only finding out at submit
  // time. Returns null for anything else (never started, already
  // submitted) or for a non-timed/non-QUIZ form.
  async getInProgressAttempt(
    form: Form,
    memberId: string,
  ): Promise<{ startedAt: Date; expiresAt: Date } | null> {
    if (form.purpose !== FormPurpose.QUIZ || form.timeLimitMinutes == null) {
      return null;
    }
    const existing = await this.attemptRepo.findOne({
      where: { form: { id: form.id }, member: { id: memberId } },
      relations: ['submission'],
      order: { startedAt: 'DESC' },
    });
    if (!existing || existing.submission) return null;
    return { startedAt: existing.startedAt, expiresAt: existing.expiresAt };
  }

  // Called from FormSubmissionService.submitAsMember before saving a
  // time-limited QUIZ submission — the attempt must exist and still be
  // within its own clock. Returns the attempt so the caller can consume it
  // once the submission is actually saved (consumeAttempt below); throwing
  // here means the submission is never written at all.
  async assertValidForSubmit(
    form: Form,
    memberId: string,
  ): Promise<FormAttempt> {
    const attempt = await this.attemptRepo.findOne({
      where: { form: { id: form.id }, member: { id: memberId } },
      relations: ['submission'],
      order: { startedAt: 'DESC' },
    });
    if (!attempt || attempt.submission) {
      throw new BadRequestException('Start the quiz before submitting.');
    }
    if (new Date() > attempt.expiresAt) {
      throw new BadRequestException("Time's up — this attempt has expired.");
    }
    return attempt;
  }

  async consumeAttempt(
    attempt: FormAttempt,
    submission: FormSubmission,
  ): Promise<void> {
    attempt.submission = submission;
    await this.attemptRepo.save(attempt);
  }
}
