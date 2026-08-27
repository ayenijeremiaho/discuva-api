import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Guest } from '../entity/guest.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { MemberService } from '../../member/service/member.service';
import { SignupDto } from '../../member/dto/signup.dto';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';

export interface EnrollGuestProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  churchName?: string;
  address?: string;
  notes?: string;
}

@Injectable()
export class GuestService {
  constructor(
    @InjectRepository(Guest)
    private readonly guestRepo: Repository<Guest>,
    @InjectRepository(ClassEnrollment)
    private readonly enrollmentRepo: Repository<ClassEnrollment>,
    private readonly memberService: MemberService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // Used by both the "new guest" enrollment form (profile fields provided,
  // no prior record) and the "existing guest" search-and-select path
  // (same email resolves to the same row) — a returning guest's contact
  // details are looked up once, not re-entered per class.
  async findOrCreateByEmail(profile: EnrollGuestProfile): Promise<Guest> {
    const existing = await this.guestRepo.findOne({
      where: { email: profile.email },
    });
    if (existing) return existing;

    const guest = this.guestRepo.create({
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      phone: profile.phone ?? null,
      churchName: profile.churchName ?? null,
      address: profile.address ?? null,
      notes: profile.notes ?? null,
    });
    return this.guestRepo.save(guest);
  }

  async getById(id: string): Promise<Guest> {
    const guest = await this.guestRepo.findOne({ where: { id } });
    if (!guest) throw new NotFoundException('Guest not found');
    return guest;
  }

  async list(
    search: string | undefined,
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<Guest>> {
    const query = this.guestRepo
      .createQueryBuilder('g')
      .orderBy('g.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (search?.trim()) {
      query.andWhere(
        '(LOWER(g.firstName) LIKE LOWER(:s) OR LOWER(g.lastName) LIKE LOWER(:s) OR LOWER(g.email) LIKE LOWER(:s))',
        { s: `%${search.trim()}%` },
      );
    }

    const [guests, total] = await query.getManyAndCount();
    return UtilityService.createPaginationResponse(guests, page, limit, total);
  }

  // Every ClassEnrollment this guest has, across all classes — the
  // cross-class history a per-class enrollment tab can't show on its own.
  async getEnrollments(guestId: string): Promise<ClassEnrollment[]> {
    await this.getById(guestId);
    return this.enrollmentRepo.find({
      where: { guest: { id: guestId } },
      relations: ['churchClass'],
      order: { enrolledAt: 'DESC' },
    });
  }

  // Creates a real Member via the same admin-created-account path used
  // everywhere else (temp password, forced change-password, welcome
  // email — MemberService.createByAdmin), then links every enrollment this
  // guest has ever had to the new member so history carries over. The
  // guest record and its profile data are kept as a historical trail, not
  // cleared — Guest.convertedMember is the permanent audit link.
  async convertToMember(guestId: string, actorId: string): Promise<Guest> {
    const guest = await this.getById(guestId);

    const signupDto: SignupDto = {
      firstname: guest.firstName,
      lastname: guest.lastName,
      email: guest.email,
      phoneNumber: guest.phone ?? undefined,
    };
    const member = await this.memberService.createByAdmin(signupDto, actorId);

    guest.convertedMember = member;
    const saved = await this.guestRepo.save(guest);

    await this.enrollmentRepo
      .createQueryBuilder()
      .update(ClassEnrollment)
      .set({ member: { id: member.id } as any })
      .where('guest_id = :guestId', { guestId })
      .execute();

    this.auditLogService.log('GUEST_CONVERTED_TO_MEMBER', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
      targetName: `${member.firstname} ${member.lastname}`,
      metadata: { guestId },
    });

    return saved;
  }
}
