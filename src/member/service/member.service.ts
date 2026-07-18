import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, In, Repository } from 'typeorm';
import { Member } from '../entity/member.entity';
import { WorkerProfile } from '../entity/worker-profile.entity';
import { Pastor } from '../entity/pastor.entity';
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
import { AssignPastorDto } from '../dto/assign-pastor.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';

@Injectable()
export class MemberService {
  private readonly logger = new Logger(MemberService.name);
  private readonly productName: string;
  private readonly churchName: string;
  private readonly churchAddress: string;

  constructor(
    @InjectRepository(Member)
    private readonly memberRepository: Repository<Member>,
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepository: Repository<WorkerProfile>,
    @InjectRepository(Pastor)
    private readonly pastorRepository: Repository<Pastor>,
    @InjectRepository(Department)
    private readonly departmentRepository: Repository<Department>,
    private readonly utilityService: UtilityService,
    private readonly auditLogService: AuditLogService,
    private readonly sessionService: MemberSessionService,
    private readonly configService: ConfigService,
    private readonly pushService: PushNotificationService,
  ) {
    this.productName = this.configService.get<string>('PRODUCT_NAME');
    this.churchName = this.configService.get<string>('CHURCH_NAME');
    this.churchAddress = this.configService.get<string>('CHURCH_ADDRESS');
  }

  async signup(dto: SignupDto): Promise<Member> {
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
    this.logger.log(`New member registered: ${saved.id}`);
    this.auditLogService.log('MEMBER_SIGNED_UP', {
      targetId: saved.id,
      targetEmail: saved.email,
    });

    const firstName = UtilityService.capitalizeFirstLetter(saved.firstname);
    this.utilityService.sendEmailWithTemplate(
      saved.email,
      `${firstName}, Welcome to ${this.productName}`,
      'welcome-member',
      {
        name: firstName,
        email: saved.email,
        password: tempPassword,
        login_url: this.configService.get<string>('LOGIN_URL'),
        churchName: this.churchName,
        churchAddress: this.churchAddress,
      },
    );

    return saved;
  }

  async promoteToWorker(
    memberId: string,
    dto: PromoteToWorkerDto,
    actorId: string,
  ): Promise<Member> {
    const member = await this.getById(memberId, ['workerProfile']);

    if (member.workerProfile) {
      throw new BadRequestException(
        'This member is already registered as a worker.',
      );
    }

    const department = await this.departmentRepository.findOneBy({
      id: dto.departmentId,
    });
    if (!department) throw new NotFoundException('Department not found');

    const profile = this.workerProfileRepository.create({
      department,
      status: WorkerStatusEnum.ACTIVE,
      profession: dto.profession,
      yearJoinedWorkforce: dto.yearJoinedWorkforce
        ? new Date(`${dto.yearJoinedWorkforce}-01-01`)
        : null,
    });
    profile.member = member;

    await this.memberRepository.manager.transaction(
      async (transactionalEntityManager) => {
        await transactionalEntityManager.save(profile);
        await transactionalEntityManager.update(Member, memberId, {
          role: MemberRoleEnum.WORKER,
        });
      },
    );

    this.logger.log(
      `Member ${memberId} promoted to worker in department ${dto.departmentId}`,
    );
    this.auditLogService.log('WORKER_PROMOTED', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
      targetName: `${member.firstname} ${member.lastname}`,
      metadata: { departmentId: dto.departmentId },
    });

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, Welcome to ${this.productName} Workforce`,
      'welcome-worker',
      {
        name: `${firstName} ${member.lastname[0].toUpperCase()}.`,
        login_url: this.configService.get<string>('LOGIN_URL'),
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
      if (member.workerProfile) {
        failures.push({
          memberId,
          reason: 'This member is already registered as a worker.',
        });
        continue;
      }
      eligible.push(member);
    }

    if (eligible.length > 0) {
      await this.memberRepository.manager.transaction(
        async (transactionalEntityManager) => {
          const profiles = eligible.map((member) => {
            const profile = this.workerProfileRepository.create({
              department,
              status: WorkerStatusEnum.ACTIVE,
              profession: dto.profession,
              yearJoinedWorkforce: dto.yearJoinedWorkforce
                ? new Date(`${dto.yearJoinedWorkforce}-01-01`)
                : null,
            });
            profile.member = member;
            return profile;
          });
          await transactionalEntityManager.save(profiles);
          await transactionalEntityManager.update(
            Member,
            eligible.map((m) => m.id),
            { role: MemberRoleEnum.WORKER },
          );
        },
      );

      for (const member of eligible) {
        this.logger.log(
          `Member ${member.id} promoted to worker in department ${dto.departmentId}`,
        );
        const firstName = UtilityService.capitalizeFirstLetter(
          member.firstname,
        );
        this.utilityService.sendEmailWithTemplate(
          member.email,
          `${firstName}, Welcome to ${this.productName} Workforce`,
          'welcome-worker',
          {
            name: `${firstName} ${member.lastname[0].toUpperCase()}.`,
            login_url: this.configService.get<string>('LOGIN_URL'),
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

  async revokeWorker(memberId: string, actorId: string): Promise<void> {
    const member = await this.getById(memberId, ['workerProfile']);
    if (!member.workerProfile)
      throw new BadRequestException(
        'This member is not registered as a worker.',
      );

    const profileId = member.workerProfile.id;

    // Use transaction to ensure all revocation steps complete atomically
    await this.memberRepository.manager.transaction(
      async (transactionalEntityManager) => {
        // Remove department lead roles — no cascade on this FK, so must be done explicitly.
        await transactionalEntityManager.delete(DepartmentLead, {
          workerProfile: { id: profileId },
        });

        // Null out any SS class teacher assignments so the revoked worker
        // is no longer listed as teacher on classes they can no longer access.
        await transactionalEntityManager.update(
          SundaySchoolClass,
          { teacher: { id: member.id } },
          { teacher: null },
        );

        // Remove worker profile
        await transactionalEntityManager.remove(member.workerProfile);

        // Update member role to MEMBER
        member.role = MemberRoleEnum.MEMBER;
        await transactionalEntityManager.save(member);
      },
    );

    this.logger.log(`Worker access revoked for member ${memberId}`);
    this.auditLogService.log('WORKER_REVOKED', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
    });

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, Your ${this.productName} Role Has Been Updated`,
      'worker-revoked',
      {
        name: firstName,
        churchName: this.churchName,
        churchAddress: this.churchAddress,
      },
    );
  }

  async assignPastor(
    memberId: string,
    dto: AssignPastorDto,
    actorId: string,
  ): Promise<Member> {
    const member = await this.getById(memberId, ['pastor']);
    if (member.pastor) {
      throw new ConflictException(
        'This member is already designated as a pastor.',
      );
    }

    const pastor = this.pastorRepository.create({ member, type: dto.type });
    await this.pastorRepository.save(pastor);

    this.auditLogService.log('PASTOR_ASSIGNED', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
      metadata: { type: dto.type },
    });

    return this.getById(memberId, [
      'workerProfile',
      'workerProfile.department',
      'pastor',
    ]);
  }

  async updatePastorType(
    memberId: string,
    dto: AssignPastorDto,
    actorId: string,
  ): Promise<Member> {
    const member = await this.getById(memberId, ['pastor']);
    if (!member.pastor) {
      throw new NotFoundException('This member is not designated as a pastor.');
    }

    member.pastor.type = dto.type;
    await this.pastorRepository.save(member.pastor);

    this.auditLogService.log('PASTOR_TYPE_UPDATED', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
      metadata: { type: dto.type },
    });

    return this.getById(memberId, [
      'workerProfile',
      'workerProfile.department',
      'pastor',
    ]);
  }

  async removePastor(memberId: string, actorId: string): Promise<void> {
    const member = await this.getById(memberId, ['pastor']);
    if (!member.pastor) {
      throw new NotFoundException('This member is not designated as a pastor.');
    }

    await this.pastorRepository.remove(member.pastor);

    this.auditLogService.log('PASTOR_REMOVED', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
    });
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
      'pastor',
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
    if (status === MemberStatusEnum.INACTIVE) {
      this.utilityService.sendEmailWithTemplate(
        member.email,
        `${firstName}, Your ${this.productName} Account Has Been Deactivated`,
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
        `${firstName}, Your ${this.productName} Account Has Been Reactivated`,
        'account-reactivated',
        {
          name: firstName,
          login_url: this.configService.get<string>('LOGIN_URL'),
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
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, Your ${this.productName} Password Has Been Reset`,
      'password-reset',
      {
        name: firstName,
        newPassword,
        login_url: this.configService.get<string>('LOGIN_URL'),
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
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, Your ${this.productName} Password Has Been Changed`,
      'password-changed',
      {
        name: firstName,
        login_url: this.configService.get<string>('LOGIN_URL'),
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
      .leftJoinAndSelect('member.pastor', 'pastor')
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
      .leftJoinAndSelect('member.pastor', 'pastor')
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
