import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindManyOptions, In, Repository } from 'typeorm';
import { Member } from '../entity/member.entity';
import { WorkerProfile } from '../entity/worker-profile.entity';
import { Clergy } from '../entity/clergy.entity';
import { ClergyTitle } from '../../clergy-title/entity/clergy-title.entity';
import { Department } from '../../department/entity/department.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { SundaySchoolClass } from '../../sunday-school/entity/sunday-school-class.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { MemberSessionService } from './member-session.service';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { ConfigService } from '@nestjs/config';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { MemberRoleEnum } from '../enums/member-role.enum';
import { MemberStatusEnum } from '../enums/member-status.enum';
import { WorkerStatusEnum } from '../enums/worker-status.enum';
import { SignupDto } from '../dto/signup.dto';
import { UpdateMemberDto } from '../dto/update-member.dto';
import { PromoteToWorkerDto } from '../dto/promote-to-worker.dto';
import { BulkPromoteToWorkerDto } from '../dto/bulk-promote-to-worker.dto';
import { UpdateWorkerProfileDto } from '../dto/update-worker-profile.dto';
import { UpdateMyProfileDto } from '../dto/update-my-profile.dto';
import { AssignClergyDto } from '../dto/assign-clergy.dto';
import { SetClergyReviewAccessDto } from '../dto/set-clergy-review-access.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

@Injectable()
export class MemberService {
  private readonly logger = new Logger(MemberService.name);
  private readonly churchName: string;
  private readonly churchAddress: string;

  constructor(
    @InjectRepository(Member)
    private readonly memberRepository: Repository<Member>,
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepository: Repository<WorkerProfile>,
    @InjectRepository(Clergy)
    private readonly clergyRepository: Repository<Clergy>,
    @InjectRepository(ClergyTitle)
    private readonly clergyTitleRepository: Repository<ClergyTitle>,
    @InjectRepository(Department)
    private readonly departmentRepository: Repository<Department>,
    private readonly utilityService: UtilityService,
    private readonly auditLogService: AuditLogService,
    private readonly sessionService: MemberSessionService,
    private readonly configService: ConfigService,
    private readonly pushService: PushNotificationService,
    private readonly cloudinaryService: CloudinaryService,
  ) {
    this.churchName = this.configService.get<string>('CHURCH_NAME');
    this.churchAddress = this.configService.get<string>('CHURCH_ADDRESS');
  }

  async signup(dto: SignupDto): Promise<Member> {
    const saved = await this.createMemberRecord(dto);
    this.auditLogService.log('MEMBER_SIGNED_UP', {
      targetId: saved.id,
      targetEmail: saved.email,
    });
    return saved;
  }

  // Same account-creation path as self-signup (temp password, forced
  // change-password on first login, welcome email) — an admin filling this
  // in on someone's behalf is otherwise identical. Promoting to worker is a
  // separate, already-existing action (POST members/:id/promote), not
  // folded into this endpoint.
  async createByAdmin(dto: SignupDto, actorId: string): Promise<Member> {
    const saved = await this.createMemberRecord(dto);
    this.auditLogService.log('MEMBER_CREATED_BY_ADMIN', {
      actorId,
      targetId: saved.id,
      targetEmail: saved.email,
      targetName: `${saved.firstname} ${saved.lastname}`,
    });
    return saved;
  }

  private async createMemberRecord(dto: SignupDto): Promise<Member> {
    await this.assertEmailUnique(dto.email);

    const tempPassword = UtilityService.generateRandomPassword();
    const password = await UtilityService.hashValue(tempPassword);

    const member = this.memberRepository.create({
      firstname: dto.firstname,
      lastname: dto.lastname,
      email: dto.email,
      password,
      phoneNumber: dto.phoneNumber,
      gender: dto.gender,
      birthDay: dto.birthDay ?? null,
      birthMonth: dto.birthMonth ?? null,
      birthYear: dto.birthYear ?? null,
      maritalStatus: dto.maritalStatus,
      yearBornAgain: dto.yearBornAgain
        ? new Date(`${dto.yearBornAgain}-01-01`)
        : null,
      yearBaptized: dto.yearBaptized
        ? new Date(`${dto.yearBaptized}-01-01`)
        : null,
      baptizedWithHolyGhost: dto.baptizedWithHolyGhost ?? false,
      dateJoinedChurch: dto.dateJoinedChurch
        ? new Date(dto.dateJoinedChurch)
        : null,
      role: MemberRoleEnum.MEMBER,
      status: MemberStatusEnum.ACTIVE,
      changedPassword: false,
    });

    const saved = await this.memberRepository.save(member);
    this.logger.log(`New member created: ${saved.id}`);

    const firstName = UtilityService.capitalizeFirstLetter(saved.firstname);
    const churchName = await this.utilityService.resolveChurchName();
    this.utilityService.sendEmailWithTemplate(
      saved.email,
      `${firstName}, Welcome to ${churchName}`,
      'welcome-member',
      {
        name: firstName,
        email: saved.email,
        password: tempPassword,
        churchName: this.churchName,
        churchAddress: this.churchAddress,
      },
    );

    return saved;
  }

  // revokeWorker()/demoteTraineeToMember() never delete the WorkerProfile row
  // (only deactivate it) so a member who is later re-promoted resumes their
  // prior progress — department/profession are only overwritten when this
  // call explicitly supplies them; completedSOD/completedBibleCollege/isTrainee
  // are left untouched either way, since they're never part of this dto.
  private buildOrReactivateWorkerProfile(
    member: Member,
    department: Department,
    dto: { profession?: string; yearJoinedWorkforce?: string },
  ): { profile: WorkerProfile; isReinstatement: boolean } {
    const isReinstatement = !!member.workerProfile;
    const profile =
      member.workerProfile ?? this.workerProfileRepository.create();
    profile.member = member;
    profile.department = department;
    profile.status = WorkerStatusEnum.ACTIVE;
    if (!isReinstatement || dto.profession !== undefined) {
      profile.profession = dto.profession;
    }
    if (!isReinstatement || dto.yearJoinedWorkforce !== undefined) {
      profile.yearJoinedWorkforce = dto.yearJoinedWorkforce
        ? new Date(`${dto.yearJoinedWorkforce}-01-01`)
        : null;
    }
    return { profile, isReinstatement };
  }

  async promoteToWorker(
    memberId: string,
    dto: PromoteToWorkerDto,
    actorId: string,
  ): Promise<Member> {
    const member = await this.getById(memberId, ['workerProfile']);

    if (member.workerProfile?.status === WorkerStatusEnum.ACTIVE) {
      throw new BadRequestException(
        'This member is already registered as a worker.',
      );
    }

    const department = await this.departmentRepository.findOneBy({
      id: dto.departmentId,
    });
    if (!department) throw new NotFoundException('Department not found');

    const { profile, isReinstatement } = this.buildOrReactivateWorkerProfile(
      member,
      department,
      dto,
    );

    await this.memberRepository.manager.transaction(
      async (transactionalEntityManager) => {
        await transactionalEntityManager.save(profile);
        await transactionalEntityManager.update(Member, memberId, {
          role: MemberRoleEnum.WORKER,
        });
      },
    );

    this.logger.log(
      `Member ${memberId} ${isReinstatement ? 'reinstated as' : 'promoted to'} worker in department ${dto.departmentId}`,
    );
    this.auditLogService.log(
      isReinstatement ? 'WORKER_REINSTATED' : 'WORKER_PROMOTED',
      {
        actorId,
        targetId: member.id,
        targetEmail: member.email,
        targetName: `${member.firstname} ${member.lastname}`,
        metadata: { departmentId: dto.departmentId },
      },
    );

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    const churchName = await this.utilityService.resolveChurchName();
    this.utilityService.sendEmailWithTemplate(
      member.email,
      isReinstatement
        ? `${firstName}, Welcome Back to ${churchName} Workforce`
        : `${firstName}, Welcome to ${churchName} Workforce`,
      'welcome-worker',
      {
        name: `${firstName} ${member.lastname[0].toUpperCase()}.`,
        username: member.email,
        explainer_video_android_url: this.configService.get<string>(
          'EXPLAINER_VIDEO_ANDROID_URL',
        ),
        explainer_video_ios_url: this.configService.get<string>(
          'EXPLAINER_VIDEO_IOS_URL',
        ),
        support_form_url: this.configService.get<string>('SUPPORT_FORM_URL'),
        churchName: this.churchName,
        churchAddress: this.churchAddress,
      },
    );

    return this.getById(memberId, [
      'workerProfile',
      'workerProfile.department',
    ]);
  }

  async bulkPromoteToWorker(
    dto: BulkPromoteToWorkerDto,
    actorId: string,
  ): Promise<{
    promoted: number;
    skipped: number;
    failures: { memberId: string; reason: string }[];
  }> {
    const uniqueIds = Array.from(new Set(dto.memberIds));

    const department = await this.departmentRepository.findOneBy({
      id: dto.departmentId,
    });
    if (!department) {
      const failures = uniqueIds.map((memberId) => ({
        memberId,
        reason: 'Department not found',
      }));
      this.auditLogService.log('BULK_WORKER_PROMOTED', {
        actorId,
        metadata: {
          promoted: 0,
          skipped: failures.length,
          departmentId: dto.departmentId,
        },
      });
      return { promoted: 0, skipped: failures.length, failures };
    }

    // Batched instead of looping promoteToWorker() per id (which cost ~5
    // round trips per member, each in its own transaction) — one batch
    // member fetch, one bulk profile insert, and one bulk role UPDATE
    // inside a single transaction, regardless of batch size.
    const members = await this.memberRepository.find({
      where: { id: In(uniqueIds) },
      relations: ['workerProfile'],
    });
    const membersById = new Map(members.map((m) => [m.id, m]));

    const failures: { memberId: string; reason: string }[] = [];
    const eligible: Member[] = [];
    for (const memberId of uniqueIds) {
      const member = membersById.get(memberId);
      if (!member) {
        failures.push({ memberId, reason: 'Member not found' });
        continue;
      }
      if (member.workerProfile?.status === WorkerStatusEnum.ACTIVE) {
        failures.push({
          memberId,
          reason: 'This member is already registered as a worker.',
        });
        continue;
      }
      eligible.push(member);
    }

    if (eligible.length > 0) {
      const built = eligible.map((member) =>
        this.buildOrReactivateWorkerProfile(member, department, dto),
      );

      await this.memberRepository.manager.transaction(
        async (transactionalEntityManager) => {
          await transactionalEntityManager.save(
            built.map(({ profile }) => profile),
          );
          await transactionalEntityManager.update(
            Member,
            eligible.map((m) => m.id),
            { role: MemberRoleEnum.WORKER },
          );
        },
      );

      const churchName = await this.utilityService.resolveChurchName();
      for (const member of eligible) {
        this.logger.log(
          `Member ${member.id} promoted to worker in department ${dto.departmentId}`,
        );
        const firstName = UtilityService.capitalizeFirstLetter(
          member.firstname,
        );
        this.utilityService.sendEmailWithTemplate(
          member.email,
          `${firstName}, Welcome to ${churchName} Workforce`,
          'welcome-worker',
          {
            name: `${firstName} ${member.lastname[0].toUpperCase()}.`,
            username: member.email,
            explainer_video_android_url: this.configService.get<string>(
              'EXPLAINER_VIDEO_ANDROID_URL',
            ),
            explainer_video_ios_url: this.configService.get<string>(
              'EXPLAINER_VIDEO_IOS_URL',
            ),
            support_form_url:
              this.configService.get<string>('SUPPORT_FORM_URL'),
            churchName: this.churchName,
            churchAddress: this.churchAddress,
          },
        );
      }
    }

    const promoted = eligible.length;
    const skipped = failures.length;

    this.auditLogService.log('BULK_WORKER_PROMOTED', {
      actorId,
      metadata: { promoted, skipped, departmentId: dto.departmentId },
    });

    return { promoted, skipped, failures };
  }

  // Shared by revokeWorker()/demoteTraineeToMember(): removes department-lead
  // roles and SS teacher assignments (no cascade on those FKs), deactivates
  // the WorkerProfile, and resets role to MEMBER. Deliberately never deletes
  // the WorkerProfile row — buildOrReactivateWorkerProfile() picks it back up
  // on a later re-promotion so completedSOD/completedBibleCollege/isTrainee
  // and department history aren't lost.
  private async deactivateWorkerAccess(
    member: Member,
    transactionalEntityManager: EntityManager,
  ): Promise<void> {
    await transactionalEntityManager.delete(DepartmentLead, {
      workerProfile: { id: member.workerProfile.id },
    });
    await transactionalEntityManager.update(
      SundaySchoolClass,
      { teacher: { id: member.id } },
      { teacher: null },
    );

    member.workerProfile.status = WorkerStatusEnum.INACTIVE;
    await transactionalEntityManager.save(member.workerProfile);

    member.role = MemberRoleEnum.MEMBER;
    await transactionalEntityManager.save(member);
  }

  async revokeWorker(memberId: string, actorId: string): Promise<void> {
    const member = await this.getById(memberId, ['workerProfile']);
    if (!member.workerProfile)
      throw new BadRequestException(
        'This member is not registered as a worker.',
      );

    await this.memberRepository.manager.transaction(
      (transactionalEntityManager) =>
        this.deactivateWorkerAccess(member, transactionalEntityManager),
    );

    this.logger.log(`Worker access revoked for member ${memberId}`);
    this.auditLogService.log('WORKER_REVOKED', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
    });

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    const churchName = await this.utilityService.resolveChurchName();
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, Your ${churchName} Role Has Been Updated`,
      'worker-revoked',
      {
        name: firstName,
        churchName: this.churchName,
        churchAddress: this.churchAddress,
      },
    );
  }

  // Same deactivation as revokeWorker(), plus clearing isTrainee (the whole
  // point of this action is ending trainee status specifically). Restricted
  // to isTrainee=true profiles so it can't be used as a substitute for a real
  // revoke-worker on an established (non-trainee) worker.
  async demoteTraineeToMember(
    memberId: string,
    actorId: string,
  ): Promise<void> {
    const member = await this.getById(memberId, [
      'workerProfile',
      'workerProfile.department',
    ]);
    if (!member.workerProfile) {
      throw new BadRequestException(
        'This member is not registered as a worker.',
      );
    }
    if (!member.workerProfile.isTrainee) {
      throw new BadRequestException(
        'Only trainee workers can be demoted via this path — use revoke-worker instead.',
      );
    }

    const departmentId = member.workerProfile.department?.id;

    await this.memberRepository.manager.transaction(
      async (transactionalEntityManager) => {
        member.workerProfile.isTrainee = false;
        await this.deactivateWorkerAccess(member, transactionalEntityManager);
      },
    );

    this.logger.log(`Trainee worker ${memberId} demoted to member`);
    this.auditLogService.log('WORKER_TRAINEE_DEMOTED', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
      targetName: `${member.firstname} ${member.lastname}`,
      metadata: { departmentId },
    });

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    const churchName = await this.utilityService.resolveChurchName();
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, Your ${churchName} Training Has Ended`,
      'trainee-demoted',
      {
        name: firstName,
        churchName: this.churchName,
        churchAddress: this.churchAddress,
      },
    );
  }

  private async getClergyTitleOrThrow(id: string): Promise<ClergyTitle> {
    const clergyTitle = await this.clergyTitleRepository.findOneBy({ id });
    if (!clergyTitle) {
      throw new NotFoundException('Clergy title not found.');
    }
    return clergyTitle;
  }

  async assignClergy(
    memberId: string,
    dto: AssignClergyDto,
    actorId: string,
  ): Promise<Member> {
    const member = await this.getById(memberId, ['clergy']);
    if (member.clergy) {
      throw new ConflictException(
        'This member is already designated as clergy.',
      );
    }
    const title = await this.getClergyTitleOrThrow(dto.clergyTitleId);

    const clergy = this.clergyRepository.create({ member, title });
    await this.clergyRepository.save(clergy);

    this.auditLogService.log('CLERGY_ASSIGNED', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
      metadata: {
        clergyTitleId: title.id,
        clergyTitleName: title.name,
      },
    });

    return this.getById(memberId, [
      'workerProfile',
      'workerProfile.department',
      'clergy',
      'clergy.title',
    ]);
  }

  async updateClergyTitle(
    memberId: string,
    dto: AssignClergyDto,
    actorId: string,
  ): Promise<Member> {
    const member = await this.getById(memberId, ['clergy']);
    if (!member.clergy) {
      throw new NotFoundException('This member is not designated as clergy.');
    }
    const title = await this.getClergyTitleOrThrow(dto.clergyTitleId);

    member.clergy.title = title;
    await this.clergyRepository.save(member.clergy);

    this.auditLogService.log('CLERGY_TITLE_CHANGED', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
      metadata: {
        clergyTitleId: title.id,
        clergyTitleName: title.name,
      },
    });

    return this.getById(memberId, [
      'workerProfile',
      'workerProfile.department',
      'clergy',
      'clergy.title',
    ]);
  }

  async removeClergy(memberId: string, actorId: string): Promise<void> {
    const member = await this.getById(memberId, ['clergy']);
    if (!member.clergy) {
      throw new NotFoundException('This member is not designated as clergy.');
    }

    await this.clergyRepository.remove(member.clergy);

    this.auditLogService.log('CLERGY_REMOVED', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
    });
  }

  // Deliberately separate from assignClergy/updateClergyTitle — holding a
  // title (a promotion/recognition) does not by itself grant the ability
  // to see and respond to every department's Pastor Feedback reports. An
  // admin flips this independently so it reads as its own deliberate
  // decision, not a side effect of a title change.
  async setClergyReviewAccess(
    memberId: string,
    dto: SetClergyReviewAccessDto,
    actorId: string,
  ): Promise<Member> {
    const member = await this.getById(memberId, ['clergy']);
    if (!member.clergy) {
      throw new NotFoundException('This member is not designated as clergy.');
    }

    member.clergy.canReviewFeedback = dto.canReviewFeedback;
    await this.clergyRepository.save(member.clergy);

    this.auditLogService.log(
      dto.canReviewFeedback
        ? 'CLERGY_REVIEW_ACCESS_GRANTED'
        : 'CLERGY_REVIEW_ACCESS_REVOKED',
      {
        actorId,
        targetId: member.id,
        targetEmail: member.email,
      },
    );

    return this.getById(memberId, [
      'workerProfile',
      'workerProfile.department',
      'clergy',
      'clergy.title',
    ]);
  }

  async updateMember(
    id: string,
    dto: UpdateMemberDto,
    actorId: string,
  ): Promise<Member> {
    const member = await this.getById(id);

    if (dto.email && dto.email !== member.email) {
      await this.assertEmailUnique(dto.email);
      member.email = dto.email;
    }

    if (dto.firstname) member.firstname = dto.firstname;
    if (dto.lastname) member.lastname = dto.lastname;
    if (dto.phoneNumber) member.phoneNumber = dto.phoneNumber;
    if (dto.gender) member.gender = dto.gender;
    if (dto.birthDay !== undefined) member.birthDay = dto.birthDay;
    if (dto.birthMonth !== undefined) member.birthMonth = dto.birthMonth;
    if (dto.birthYear !== undefined) member.birthYear = dto.birthYear ?? null;
    if (dto.maritalStatus) member.maritalStatus = dto.maritalStatus;
    if (dto.yearBornAgain)
      member.yearBornAgain = new Date(`${dto.yearBornAgain}-01-01`);
    if (dto.yearBaptized)
      member.yearBaptized = new Date(`${dto.yearBaptized}-01-01`);
    if (dto.baptizedWithHolyGhost !== undefined)
      member.baptizedWithHolyGhost = dto.baptizedWithHolyGhost;
    if (dto.dateJoinedChurch)
      member.dateJoinedChurch = new Date(dto.dateJoinedChurch);

    const saved = await this.memberRepository.save(member);
    this.auditLogService.log('MEMBER_UPDATED', {
      actorId,
      targetId: id,
      targetEmail: saved.email,
      metadata: { changes: Object.keys(dto) },
    });
    return saved;
  }

  async updateMyProfile(
    memberId: string,
    dto: UpdateMyProfileDto,
  ): Promise<Member> {
    const member = await this.getById(memberId, [
      'workerProfile',
      'workerProfile.department',
      'clergy',
      'clergy.title',
    ]);

    if (dto.firstname) member.firstname = dto.firstname;
    if (dto.lastname) member.lastname = dto.lastname;
    if (dto.phoneNumber) member.phoneNumber = dto.phoneNumber;
    if (dto.gender) member.gender = dto.gender;
    if (dto.birthDay !== undefined) member.birthDay = dto.birthDay;
    if (dto.birthMonth !== undefined) member.birthMonth = dto.birthMonth;
    if (dto.birthYear !== undefined) member.birthYear = dto.birthYear ?? null;
    if (dto.maritalStatus) member.maritalStatus = dto.maritalStatus;

    const saved = await this.memberRepository.save(member);
    this.auditLogService.log('MEMBER_UPDATED', {
      actorId: memberId,
      targetId: memberId,
      targetEmail: saved.email,
      metadata: { changes: Object.keys(dto), self: true },
    });
    return saved;
  }

  async updateMyPhoto(
    memberId: string,
    file: Express.Multer.File,
  ): Promise<Member> {
    const member = await this.getById(memberId, [
      'workerProfile',
      'workerProfile.department',
      'clergy',
      'clergy.title',
    ]);

    const previousPublicId = member.photoPublicId;
    const uploaded = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      'profile-pictures',
      undefined,
      file.mimetype,
    );
    member.photoUrl = uploaded.secureUrl;
    member.photoPublicId = uploaded.publicId;

    const saved = await this.memberRepository.save(member);

    if (previousPublicId) {
      this.cloudinaryService.deleteByPublicId(previousPublicId, 'image');
    }

    this.auditLogService.log('MEMBER_PHOTO_UPDATED', {
      actorId: memberId,
      targetId: memberId,
      targetEmail: saved.email,
      metadata: { self: true },
    });
    return saved;
  }

  async removeMyPhoto(memberId: string): Promise<Member> {
    const member = await this.getById(memberId, [
      'workerProfile',
      'workerProfile.department',
      'clergy',
      'clergy.title',
    ]);
    const saved = await this.clearPhoto(member);
    this.auditLogService.log('MEMBER_PHOTO_REMOVED', {
      actorId: memberId,
      targetId: memberId,
      targetEmail: saved.email,
      metadata: { self: true },
    });
    return saved;
  }

  async removeMemberPhoto(memberId: string, actorId: string): Promise<Member> {
    const member = await this.getById(memberId, [
      'workerProfile',
      'workerProfile.department',
      'clergy',
      'clergy.title',
    ]);
    const saved = await this.clearPhoto(member);
    this.auditLogService.log('MEMBER_PHOTO_REMOVED', {
      actorId,
      targetId: memberId,
      targetEmail: saved.email,
      metadata: { self: false },
    });
    return saved;
  }

  private async clearPhoto(member: Member): Promise<Member> {
    const previousPublicId = member.photoPublicId;
    member.photoUrl = null;
    member.photoPublicId = null;
    const saved = await this.memberRepository.save(member);
    if (previousPublicId) {
      this.cloudinaryService.deleteByPublicId(previousPublicId, 'image');
    }
    return saved;
  }

  async updateEmail(memberId: string, newEmail: string): Promise<void> {
    await this.memberRepository.update(memberId, { email: newEmail });
  }

  async updateWorkerProfile(
    memberId: string,
    dto: UpdateWorkerProfileDto,
    actorId: string,
  ): Promise<WorkerProfile> {
    const member = await this.getById(memberId, [
      'workerProfile',
      'workerProfile.department',
      'workerProfile.secondaryDepartment',
    ]);
    if (!member.workerProfile)
      throw new BadRequestException(
        'This member does not have a worker profile.',
      );

    const profile = member.workerProfile;

    if (dto.departmentId && dto.departmentId !== profile.department?.id) {
      profile.department = await this.resolveDepartment(
        dto.departmentId,
        'Department not found',
      );
    }

    if ('secondaryDepartmentId' in dto) {
      profile.secondaryDepartment = await this.resolveSecondaryDepartment(
        dto.secondaryDepartmentId,
        profile.secondaryDepartment,
      );
    }

    if (dto.status) profile.status = dto.status;
    if (dto.profession) profile.profession = dto.profession;
    if (dto.yearJoinedWorkforce)
      profile.yearJoinedWorkforce = new Date(
        `${dto.yearJoinedWorkforce}-01-01`,
      );
    if (dto.completedSOD !== undefined) profile.completedSOD = dto.completedSOD;
    if (dto.completedBibleCollege !== undefined)
      profile.completedBibleCollege = dto.completedBibleCollege;
    if (dto.isTrainee !== undefined) profile.isTrainee = dto.isTrainee;

    const saved = await this.workerProfileRepository.save(profile);
    this.auditLogService.log('WORKER_PROFILE_UPDATED', {
      actorId,
      targetId: memberId,
      metadata: { changes: Object.keys(dto) },
    });
    return saved;
  }

  async changeStatus(
    memberId: string,
    status: MemberStatusEnum,
    actorId: string,
  ): Promise<void> {
    const member = await this.getById(memberId);
    if (member.status === status) {
      throw new BadRequestException(
        `This member's account is already ${status.toLowerCase()}.`,
      );
    }
    member.status = status;
    await this.memberRepository.save(member);
    this.logger.log(
      `Member ${memberId} status changed to ${status} by actor ${actorId}`,
    );
    this.auditLogService.log(
      status === MemberStatusEnum.INACTIVE
        ? 'MEMBER_DEACTIVATED'
        : 'MEMBER_ACTIVATED',
      {
        actorId,
        targetId: member.id,
        targetEmail: member.email,
      },
    );

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    const churchName = await this.utilityService.resolveChurchName();
    if (status === MemberStatusEnum.INACTIVE) {
      this.utilityService.sendEmailWithTemplate(
        member.email,
        `${firstName}, Your ${churchName} Account Has Been Deactivated`,
        'account-deactivated',
        {
          name: firstName,
          churchName: this.churchName,
          churchAddress: this.churchAddress,
        },
      );
    } else if (status === MemberStatusEnum.ACTIVE) {
      this.utilityService.sendEmailWithTemplate(
        member.email,
        `${firstName}, Your ${churchName} Account Has Been Reactivated`,
        'account-reactivated',
        {
          name: firstName,
          churchName: this.churchName,
          churchAddress: this.churchAddress,
        },
      );
    }
  }

  async resetPassword(memberId: string, actorId: string): Promise<string> {
    const member = await this.getByIdWithCredentials(memberId);
    const newPassword = UtilityService.generateRandomPassword();
    member.password = await UtilityService.hashValue(newPassword);
    member.changedPassword = false;
    await this.memberRepository.save(member);
    this.logger.log(
      `Password reset by admin ${actorId} for member ${memberId}`,
    );
    this.auditLogService.log('ADMIN_PASSWORD_RESET', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
    });

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    const churchName = await this.utilityService.resolveChurchName();
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, Your ${churchName} Password Has Been Reset`,
      'password-reset',
      {
        name: firstName,
        newPassword,
        churchName: this.churchName,
        churchAddress: this.churchAddress,
      },
    );

    return 'Password reset successfully';
  }

  async changePassword(
    memberId: string,
    dto: ChangePasswordDto,
  ): Promise<string> {
    const member = await this.getByIdWithCredentials(memberId);

    const isValid = await UtilityService.verifyHashedValue(
      dto.oldPassword,
      member.password,
    );
    if (!isValid)
      throw new BadRequestException(
        'The current password you entered is incorrect.',
      );

    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException(
        'New password and confirm password do not match',
      );
    }

    member.password = await UtilityService.hashValue(dto.newPassword);
    member.changedPassword = true;
    await this.memberRepository.save(member);

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    const churchName = await this.utilityService.resolveChurchName();
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, Your ${churchName} Password Has Been Changed`,
      'password-changed',
      {
        name: firstName,
        churchName: this.churchName,
        churchAddress: this.churchAddress,
      },
    );

    return 'Password changed successfully';
  }

  async setPassword(
    memberId: string,
    newPassword: string,
    changedPassword: boolean,
  ): Promise<void> {
    const member = await this.getByIdWithCredentials(memberId);
    member.password = await UtilityService.hashValue(newPassword);
    member.changedPassword = changedPassword;
    await this.memberRepository.save(member);
  }

  async setDeviceId(memberId: string, deviceId: string): Promise<void> {
    await this.memberRepository.update(memberId, { deviceId });
  }

  async purgeDevice(memberId: string, actorId: string): Promise<void> {
    await this.memberRepository.update(memberId, { deviceId: null });
    await Promise.all([
      this.sessionService.updateLogout(memberId, SessionSurface.MEMBER),
      this.sessionService.updateLogout(memberId, SessionSurface.ADMIN),
    ]);
    this.pushService.unsubscribe(memberId);
    this.logger.log(
      `Device lock purged for member ${memberId} by actor ${actorId}`,
    );
    this.auditLogService.log('DEVICE_PURGED', { actorId, targetId: memberId });
  }

  async getById(id: string, relations: string[] = []): Promise<Member> {
    const member = await this.memberRepository.findOne({
      where: { id },
      relations,
    });
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  async getByIdWithCredentials(id: string): Promise<Member> {
    const member = await this.memberRepository
      .createQueryBuilder('member')
      .addSelect('member.password')
      .addSelect('member.deviceId')
      .where('member.id = :id', { id })
      .getOne();
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  async findByEmail(email: string): Promise<Member | null> {
    return this.memberRepository
      .createQueryBuilder('member')
      .addSelect('member.password')
      .addSelect('member.deviceId')
      .leftJoinAndSelect('member.workerProfile', 'workerProfile')
      .leftJoinAndSelect('workerProfile.department', 'department')
      .where('member.email = :email', { email })
      .getOne();
  }

  async getAll(
    page = 1,
    limit = 10,
    role?: MemberRoleEnum,
    search?: string,
  ): Promise<PaginationResponseDto<Member>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const qb = this.memberRepository
      .createQueryBuilder('member')
      .leftJoinAndSelect('member.workerProfile', 'workerProfile')
      .leftJoinAndSelect('workerProfile.department', 'department')
      .leftJoinAndSelect('member.clergy', 'clergy')
      .leftJoinAndSelect('clergy.title', 'clergyTitle')
      .orderBy('member.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (role) qb.andWhere('member.role = :role', { role });
    if (search) {
      qb.andWhere(
        '(LOWER(member.firstname) LIKE LOWER(:s) OR LOWER(member.lastname) LIKE LOWER(:s) OR LOWER(member.email) LIKE LOWER(:s) OR member.phoneNumber LIKE :s)',
        { s: `%${search}%` },
      );
    }

    const [members, total] = await qb.getManyAndCount();
    return UtilityService.createPaginationResponse(members, page, limit, total);
  }

  // Narrow, bounded, minimal-field search — built specifically for the
  // Admin-department mobile check-in flow (AttendanceController's
  // department/search-members route), not a general member picker. No email
  // or phone in the result: department/role is disambiguation enough, per
  // the same principle already applied to the birthday-wish celebrant list.
  async searchActiveMembersLite(
    query: string,
    limit = 10,
  ): Promise<Pick<Member, 'id' | 'firstname' | 'lastname' | 'role'>[]> {
    if (!query.trim()) return [];
    return this.memberRepository
      .createQueryBuilder('member')
      .select([
        'member.id',
        'member.firstname',
        'member.lastname',
        'member.role',
      ])
      .where('member.status = :status', { status: MemberStatusEnum.ACTIVE })
      .andWhere(
        '(LOWER(member.firstname) LIKE LOWER(:s) OR LOWER(member.lastname) LIKE LOWER(:s))',
        { s: `%${query}%` },
      )
      .take(limit)
      .getMany();
  }

  async getWorkers(
    page = 1,
    limit = 10,
    status?: WorkerStatusEnum,
  ): Promise<PaginationResponseDto<Member>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const qb = this.memberRepository
      .createQueryBuilder('member')
      .innerJoinAndSelect('member.workerProfile', 'profile')
      .innerJoinAndSelect('profile.department', 'department')
      .leftJoinAndSelect('member.clergy', 'clergy')
      .leftJoinAndSelect('clergy.title', 'clergyTitle')
      .where('member.role = :role', { role: MemberRoleEnum.WORKER });

    if (status) {
      qb.andWhere('profile.status = :status', { status });
    }

    const [members, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('member.createdAt', 'DESC')
      .getManyAndCount();

    return UtilityService.createPaginationResponse(members, page, limit, total);
  }

  // Batch-only: used exclusively by the attendance scheduler to build push-notification lists.
  // Never call from a request-scoped context — no take/limit is intentional.
  async getMembersNotCheckedInForEvent(eventId: string): Promise<Member[]> {
    return this.memberRepository
      .createQueryBuilder('member')
      .leftJoin(
        'attendances',
        'attendance',
        `attendance.member_id = member.id AND attendance.event_id = :eventId AND attendance.status IN ('PRESENT','LATE')`,
        { eventId },
      )
      .where('attendance.id IS NULL')
      .andWhere('member.status = :status', { status: MemberStatusEnum.ACTIVE })
      .andWhere('member.role = :role', { role: MemberRoleEnum.MEMBER })
      .getMany();
  }

  // Batch-only: used exclusively by the attendance scheduler to build push-notification lists.
  // Never call from a request-scoped context — no take/limit is intentional.
  async getWorkersNotCheckedInForEvent(eventId: string): Promise<Member[]> {
    return this.memberRepository
      .createQueryBuilder('member')
      .innerJoin('member.workerProfile', 'profile')
      .leftJoin(
        'attendances',
        'attendance',
        `attendance.member_id = member.id AND attendance.event_id = :eventId AND attendance.status IN ('PRESENT','LATE')`,
        { eventId },
      )
      .where('attendance.id IS NULL')
      .andWhere('member.role = :role', { role: MemberRoleEnum.WORKER })
      .andWhere('profile.status = :status', { status: WorkerStatusEnum.ACTIVE })
      .getMany();
  }

  async count(options?: FindManyOptions<Member>): Promise<number> {
    return this.memberRepository.count(options);
  }

  private async resolveDepartment(id: string, notFoundMsg: string) {
    const dept = await this.departmentRepository.findOneBy({ id });
    if (!dept) throw new NotFoundException(notFoundMsg);
    return dept;
  }

  private async resolveSecondaryDepartment(
    incomingId: string | null | undefined,
    current: Department | null,
  ) {
    if (incomingId === null) return null;
    if (incomingId && incomingId !== current?.id) {
      return this.resolveDepartment(
        incomingId,
        'Secondary department not found',
      );
    }
    return current; // unchanged
  }

  private async assertEmailUnique(email: string): Promise<void> {
    const exists = await this.memberRepository.exists({ where: { email } });
    if (exists)
      throw new ConflictException('Email address is already registered');
  }
}
