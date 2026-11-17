import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { ChildProfile } from '../entity/child-profile.entity';
import { ChildGuardian } from '../entity/child-guardian.entity';
import { ChildCheckIn } from '../entity/child-check-in.entity';
import { ChildCheckInNote } from '../entity/child-checkin-note.entity';
import { ChildNoteKind } from '../enums/child-note-kind.enum';
import { ChildCheckInStatusEnum } from '../enums/child-checkin-status.enum';
import { Member } from '../../member/entity/member.entity';
import { MemberAuth } from '../../auth/interface/auth.interface';
import {
  ParentReplyDto,
  SetAwayDto,
  UpdateChildCareDto,
} from '../dto/child-care.dto';
import { ChildrenChurchService } from './children-church.service';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { churchDay, personName } from '../church-day';

const NOTE_PREVIEW = 120;

// What a parent or guardian on the app can see and do for their own child.
@Injectable()
export class ChildCareService {
  private readonly logger = new Logger(ChildCareService.name);

  constructor(
    @InjectRepository(ChildProfile)
    private readonly childRepo: Repository<ChildProfile>,
    @InjectRepository(ChildGuardian)
    private readonly guardianRepo: Repository<ChildGuardian>,
    @InjectRepository(ChildCheckIn)
    private readonly checkInRepo: Repository<ChildCheckIn>,
    @InjectRepository(ChildCheckInNote)
    private readonly noteRepo: Repository<ChildCheckInNote>,
    private readonly children: ChildrenChurchService,
    private readonly tz: ChurchTimezoneService,
    private readonly cloudinary: CloudinaryService,
    private readonly push: PushNotificationService,
  ) {}

  async view(user: MemberAuth, childId: string) {
    const me = await this.requireGuardian(user, childId);
    const { ymd, start } = churchDay(await this.tz.get());

    const [child, guardians, today] = await Promise.all([
      this.childRepo
        .createQueryBuilder('c')
        .leftJoinAndSelect('c.ageGroup', 'ageGroup')
        .leftJoinAndSelect('c.classGroup', 'classGroup')
        .leftJoin('c.notesUpdatedBy', 'nub')
        .addSelect(['nub.id', 'nub.firstname', 'nub.lastname'])
        .leftJoin('c.awayCollector', 'ac')
        .addSelect(['ac.id', 'ac.fullName'])
        .where('c.id = :childId', { childId })
        .getOne(),
      this.guardianRepo.find({
        where: { child: { id: childId } },
        relations: ['member'],
        select: {
          id: true,
          createdAt: true,
          fullName: true,
          relationship: true,
          isAuthorizedPickup: true,
          member: { id: true },
        },
        order: { createdAt: 'ASC' },
      }),
      this.checkInRepo
        .createQueryBuilder('ci')
        .leftJoin('ci.checkedInBy', 'tin')
        .addSelect(['tin.id', 'tin.firstname', 'tin.lastname'])
        .leftJoin('ci.checkedOutBy', 'tout')
        .addSelect(['tout.id', 'tout.firstname', 'tout.lastname'])
        .leftJoin('ci.serviceSlot', 'slot')
        .addSelect(['slot.id', 'slot.name'])
        .where('ci.child_id = :childId', { childId })
        .andWhere('ci.checkin_time >= :start', { start })
        .orderBy('ci.checkinTime', 'DESC')
        .getOne(),
    ]);
    if (!child) throw new NotFoundException('Child not found');

    const notes = today ? await this.notesForParent(today.id, user.id) : [];

    return {
      child: {
        id: child.id,
        firstname: child.firstname,
        lastname: child.lastname,
        dateOfBirth: child.dateOfBirth,
        ageRange: child.ageRange,
        ageRangeSetOn: child.ageRangeSetOn,
        photoUrl: child.photoUrl,
        specialNotes: child.specialNotes,
        notesUpdatedAt: child.notesUpdatedAt,
        notesUpdatedBy: personName(child.notesUpdatedBy),
        emergencyContactName: child.emergencyContactName,
        emergencyContactRelationship: child.emergencyContactRelationship,
        emergencyContactPhone: child.emergencyContactPhone,
        doctorName: child.doctorName,
        doctorPhone: child.doctorPhone,
        ageGroup: child.ageGroup,
        classGroup: child.classGroup
          ? { id: child.classGroup.id, name: child.classGroup.name }
          : null,
        createdAt: child.createdAt,
      },
      guardians: guardians.map((g) => ({
        id: g.id,
        fullName: g.fullName,
        relationship: g.relationship,
        isAuthorizedPickup: g.isAuthorizedPickup,
        isMe: g.member?.id === user.id,
      })),
      today: today
        ? {
            id: today.id,
            status: today.status,
            checkinTime: today.checkinTime,
            checkoutTime: today.checkoutTime,
            droppedOffByName: today.droppedOffByName,
            pickedUpByName: today.pickedUpByName,
            receivedBy: personName(today.checkedInBy),
            handedBackBy: personName(today.checkedOutBy),
            serviceName: today.serviceSlot?.name ?? null,
            pickupCode:
              me.isAuthorizedPickup &&
              today.status === ChildCheckInStatusEnum.CHECKED_IN
                ? today.pickupCode
                : null,
          }
        : null,
      notes,
      away:
        child.awayDate === ymd && child.awayCollector
          ? {
              collectorGuardianId: child.awayCollector.id,
              collectorName: child.awayCollector.fullName,
              message: child.awayMessage,
            }
          : null,
    };
  }

  async update(user: MemberAuth, childId: string, dto: UpdateChildCareDto) {
    await this.requireGuardian(user, childId);
    const child = await this.childRepo.findOne({
      where: { id: childId },
      relations: ['ageGroup', 'classGroup'],
    });
    if (!child) throw new NotFoundException('Child not found');

    if (dto.specialNotes !== undefined) {
      const text = dto.specialNotes
        .map((n) => n.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
      if (text !== (child.specialNotes ?? '')) {
        child.specialNotes = text || null;
        child.notesUpdatedBy = { id: user.id } as Member;
        child.notesUpdatedAt = new Date();
      }
    }
    const contact = [
      'emergencyContactName',
      'emergencyContactRelationship',
      'emergencyContactPhone',
      'doctorName',
      'doctorPhone',
    ] as const;
    for (const key of contact) {
      if (dto[key] !== undefined) child[key] = dto[key]?.trim() || null;
    }
    if (dto.dateOfBirth) {
      Object.assign(
        child,
        this.children.ageFields({ dateOfBirth: dto.dateOfBirth }),
      );
      Object.assign(child, await this.children.computeAgeGroup(child));
    }
    await this.childRepo.save(child);
    return this.view(user, childId);
  }

  async uploadPhoto(
    user: MemberAuth,
    childId: string,
    file: Express.Multer.File,
  ) {
    await this.requireGuardian(user, childId);
    if (!file?.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Please choose a photo.');
    }
    const uploaded = await this.cloudinary.uploadBuffer(
      file.buffer,
      'child-photos',
      `${childId}-${Date.now()}`,
      file.mimetype,
    );
    await this.childRepo.update(childId, { photoUrl: uploaded.secureUrl });
    return { photoUrl: uploaded.secureUrl };
  }

  async setAway(user: MemberAuth, childId: string, dto: SetAwayDto) {
    await this.requireGuardian(user, childId);
    const collector = await this.guardianRepo.findOne({
      where: { id: dto.collectorGuardianId, child: { id: childId } },
      select: { id: true, isAuthorizedPickup: true },
    });
    if (!collector?.isAuthorizedPickup) {
      throw new BadRequestException(
        "Choose someone who's allowed to collect this child.",
      );
    }
    const { ymd } = churchDay(await this.tz.get());
    await this.childRepo.update(childId, {
      awayDate: ymd,
      awayCollector: { id: collector.id } as ChildGuardian,
      awayMessage: dto.message?.trim() || null,
      awaySetBy: { id: user.id } as Member,
    });
    return this.view(user, childId);
  }

  async clearAway(user: MemberAuth, childId: string) {
    await this.requireGuardian(user, childId);
    await this.childRepo.update(childId, {
      awayDate: null,
      awayCollector: null,
      awayMessage: null,
      awaySetBy: null,
    });
    return this.view(user, childId);
  }

  async reply(user: MemberAuth, childId: string, dto: ParentReplyDto) {
    await this.requireGuardian(user, childId);
    const { start } = churchDay(await this.tz.get());
    const today = await this.checkInRepo.findOne({
      where: { child: { id: childId }, checkinTime: MoreThanOrEqual(start) },
      relations: ['child', 'checkedInBy'],
      select: {
        id: true,
        checkinTime: true,
        child: { id: true, firstname: true },
        checkedInBy: { id: true },
      },
      order: { checkinTime: 'DESC' },
    });
    if (!today) {
      throw new BadRequestException(
        'You can reply once your child is checked in today.',
      );
    }
    const latest = await this.noteRepo.findOne({
      where: {
        checkIn: { id: today.id },
        fromParent: false,
        sharedWithParents: true,
      },
      relations: ['author'],
      select: { id: true, createdAt: true, author: { id: true } },
      order: { createdAt: 'DESC' },
    });
    const note = await this.noteRepo.save(
      this.noteRepo.create({
        checkIn: { id: today.id } as ChildCheckIn,
        author: { id: user.id } as Member,
        fromParent: true,
        kind: ChildNoteKind.PARENT_REPLY,
        text: dto.text.trim(),
        sharedWithParents: true,
        replyTo: latest ? ({ id: latest.id } as ChildCheckInNote) : null,
      }),
    );

    const teacherIds = await this.teachersOn(today.id, today.checkedInBy?.id);
    const parent = await this.childRepo.manager.findOne(Member, {
      where: { id: user.id },
      select: { id: true, firstname: true, lastname: true },
    });
    this.push
      .dispatchToMemberIds(
        teacherIds.filter((id) => id !== user.id),
        {
          key: PushNotificationKey.CHILD_NOTE_REPLY,
          idempotencyKey: `cc-note:${note.id}`,
          vars: {
            parent_name: personName(parent) ?? 'A parent',
            child_name: today.child.firstname,
            note: note.text.slice(0, NOTE_PREVIEW),
          },
        },
      )
      .catch((err) => this.logger.error(`Reply push failed: ${err.message}`));
    return this.view(user, childId);
  }

  private async notesForParent(checkInId: string, memberId: string) {
    const rows = await this.noteRepo
      .createQueryBuilder('n')
      .leftJoin('n.author', 'a')
      .addSelect(['a.id', 'a.firstname', 'a.lastname'])
      .leftJoin('n.replyTo', 'r')
      .addSelect(['r.id'])
      .where('n.check_in_id = :checkInId', { checkInId })
      .andWhere('n.shared_with_parents = true')
      .orderBy('n.created_at', 'ASC')
      .getMany();
    const unseen = rows
      .filter((n) => !n.fromParent && !n.parentSeenAt)
      .map((n) => n.id);
    if (unseen.length) {
      this.noteRepo
        .update(
          { id: In(unseen), parentSeenAt: IsNull() },
          {
            parentSeenAt: new Date(),
            parentSeenBy: { id: memberId } as Member,
          },
        )
        .catch((err) =>
          this.logger.error(`Marking notes seen failed: ${err.message}`),
        );
    }
    return rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      text: n.text,
      fromParent: n.fromParent,
      authorName: personName(n.author),
      isMine: n.author?.id === memberId,
      replyToId: n.replyTo?.id ?? null,
      createdAt: n.createdAt,
      isNew: unseen.includes(n.id),
    }));
  }

  // The teacher who checked the child in plus every teacher who wrote a note on this visit.
  async teachersOn(checkInId: string, checkedInById?: string | null) {
    const authors = await this.noteRepo
      .createQueryBuilder('n')
      .select('DISTINCT n.author_id', 'id')
      .where('n.check_in_id = :checkInId', { checkInId })
      .andWhere('n.from_parent = false')
      .andWhere('n.author_id IS NOT NULL')
      .getRawMany<{ id: string }>();
    return [
      ...new Set(
        [checkedInById, ...authors.map((a) => a.id)].filter(
          (id): id is string => !!id,
        ),
      ),
    ];
  }

  async requireGuardian(
    user: MemberAuth,
    childId: string,
  ): Promise<{ id: string; isAuthorizedPickup: boolean }> {
    const me = await this.guardianRepo.findOne({
      where: { child: { id: childId }, member: { id: user.id } },
      select: { id: true, isAuthorizedPickup: true },
    });
    if (!me) throw new NotFoundException('Child not found');
    return me;
  }
}
