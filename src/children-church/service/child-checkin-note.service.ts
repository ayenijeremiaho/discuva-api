import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChildCheckIn } from '../entity/child-check-in.entity';
import { ChildCheckInNote } from '../entity/child-checkin-note.entity';
import { ChildGuardian } from '../entity/child-guardian.entity';
import { ChildNoteKind } from '../enums/child-note-kind.enum';
import { Member } from '../../member/entity/member.entity';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { AddCheckInNoteDto } from '../dto/child-care.dto';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { churchDay, personName } from '../church-day';

const NOTE_PREVIEW = 120;

// The team's view of one visit: who brought the child, how to reach family, and the day's notes.
@Injectable()
export class ChildCheckInNoteService {
  private readonly logger = new Logger(ChildCheckInNoteService.name);

  constructor(
    @InjectRepository(ChildCheckIn)
    private readonly checkInRepo: Repository<ChildCheckIn>,
    @InjectRepository(ChildCheckInNote)
    private readonly noteRepo: Repository<ChildCheckInNote>,
    @InjectRepository(ChildGuardian)
    private readonly guardianRepo: Repository<ChildGuardian>,
    private readonly access: DepartmentAccessService,
    private readonly tz: ChurchTimezoneService,
    private readonly push: PushNotificationService,
  ) {}

  async detail(user: MemberAuth, checkInId: string) {
    await this.requireTeam(user);
    const ci = await this.checkInRepo
      .createQueryBuilder('ci')
      .innerJoinAndSelect('ci.child', 'c')
      .leftJoinAndSelect('c.classGroup', 'cg')
      .leftJoin('c.notesUpdatedBy', 'nub')
      .addSelect(['nub.id', 'nub.firstname', 'nub.lastname'])
      .leftJoin('c.awayCollector', 'ac')
      .addSelect(['ac.id', 'ac.fullName', 'ac.relationship'])
      .leftJoin('ci.checkedInBy', 'tin')
      .addSelect(['tin.id', 'tin.firstname', 'tin.lastname'])
      .leftJoin('ci.checkedOutBy', 'tout')
      .addSelect(['tout.id', 'tout.firstname', 'tout.lastname'])
      .leftJoin('ci.droppedOffBy', 'dg')
      .addSelect(['dg.id', 'dg.fullName', 'dg.relationship'])
      .leftJoin('ci.serviceSlot', 'slot')
      .addSelect(['slot.id', 'slot.name'])
      .where('ci.id = :checkInId', { checkInId })
      .getOne();
    if (!ci) throw new NotFoundException('Check-in not found');

    const [guardians, notes, { ymd }] = await Promise.all([
      this.guardianRepo.find({
        where: { child: { id: ci.child.id } },
        relations: ['member'],
        select: {
          id: true,
          createdAt: true,
          fullName: true,
          relationship: true,
          isAuthorizedPickup: true,
          member: { id: true, firstname: true },
        },
        order: { createdAt: 'ASC' },
      }),
      this.notes(checkInId),
      this.tz.get().then((tz) => churchDay(tz)),
    ]);
    const c = ci.child;

    return {
      id: ci.id,
      status: ci.status,
      checkinTime: ci.checkinTime,
      checkoutTime: ci.checkoutTime,
      pickupCode: ci.pickupCode,
      flagReason: ci.flagReason,
      serviceName: ci.serviceSlot?.name ?? null,
      droppedOffBy: ci.droppedOffBy
        ? {
            name: ci.droppedOffBy.fullName,
            relationship: ci.droppedOffBy.relationship,
          }
        : ci.droppedOffByName
          ? { name: ci.droppedOffByName, relationship: null }
          : null,
      pickedUpByName: ci.pickedUpByName,
      receivedBy: personName(ci.checkedInBy),
      handedBackBy: personName(ci.checkedOutBy),
      child: {
        id: c.id,
        firstname: c.firstname,
        lastname: c.lastname,
        dateOfBirth: c.dateOfBirth,
        ageRange: c.ageRange,
        ageRangeSetOn: c.ageRangeSetOn,
        photoUrl: c.photoUrl,
        classGroup: c.classGroup
          ? { id: c.classGroup.id, name: c.classGroup.name }
          : null,
        specialNotes: c.specialNotes,
        notesUpdatedAt: c.notesUpdatedAt,
        notesUpdatedBy: personName(c.notesUpdatedBy),
        emergencyContactName: c.emergencyContactName,
        emergencyContactRelationship: c.emergencyContactRelationship,
        emergencyContactPhone: c.emergencyContactPhone,
        doctorName: c.doctorName,
        doctorPhone: c.doctorPhone,
      },
      guardians: guardians.map((g) => ({
        id: g.id,
        fullName: g.fullName,
        relationship: g.relationship,
        isAuthorizedPickup: g.isAuthorizedPickup,
        onApp: !!g.member,
      })),
      away:
        c.awayDate === ymd && c.awayCollector
          ? {
              collectorName: c.awayCollector.fullName,
              collectorRelationship: c.awayCollector.relationship,
              message: c.awayMessage,
            }
          : null,
      notes,
    };
  }

  async add(user: MemberAuth, checkInId: string, dto: AddCheckInNoteDto) {
    await this.requireTeam(user);
    const ci = await this.checkInRepo.findOne({
      where: { id: checkInId },
      relations: ['child'],
      select: { id: true, child: { id: true, firstname: true } },
    });
    if (!ci) throw new NotFoundException('Check-in not found');
    const shared =
      dto.kind !== ChildNoteKind.TEAM_ONLY && (dto.shareWithParents ?? true);
    const note = await this.noteRepo.save(
      this.noteRepo.create({
        checkIn: { id: ci.id } as ChildCheckIn,
        author: { id: user.id } as Member,
        fromParent: false,
        kind: dto.kind,
        text: dto.text.trim(),
        sharedWithParents: shared,
      }),
    );
    if (shared) this.tellParents(ci, note, user.id);
    return this.notes(checkInId);
  }

  async notes(checkInId: string) {
    const rows = await this.noteRepo
      .createQueryBuilder('n')
      .leftJoin('n.author', 'a')
      .addSelect(['a.id', 'a.firstname', 'a.lastname'])
      .leftJoin('n.parentSeenBy', 's')
      .addSelect(['s.id', 's.firstname'])
      .leftJoin('n.replyTo', 'r')
      .addSelect(['r.id'])
      .where('n.check_in_id = :checkInId', { checkInId })
      .orderBy('n.created_at', 'DESC')
      .getMany();
    return rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      text: n.text,
      fromParent: n.fromParent,
      sharedWithParents: n.sharedWithParents,
      authorName: personName(n.author),
      replyToId: n.replyTo?.id ?? null,
      seenBy: n.parentSeenBy?.firstname ?? null,
      seenAt: n.parentSeenAt,
      createdAt: n.createdAt,
    }));
  }

  private tellParents(
    ci: ChildCheckIn,
    note: ChildCheckInNote,
    authorId: string,
  ) {
    Promise.all([
      this.guardianRepo
        .createQueryBuilder('g')
        .select('g.member_id', 'id')
        .where('g.child_id = :childId', { childId: ci.child.id })
        .andWhere('g.member_id IS NOT NULL')
        .getRawMany<{ id: string }>(),
      this.noteRepo.manager.findOne(Member, {
        where: { id: authorId },
        select: { id: true, firstname: true, lastname: true },
      }),
    ])
      .then(([rows, author]) =>
        this.push.dispatchToMemberIds([...new Set(rows.map((r) => r.id))], {
          key: PushNotificationKey.CHILD_NOTE_SHARED,
          idempotencyKey: `cc-note:${note.id}`,
          vars: {
            child_name: ci.child.firstname,
            teacher_name: personName(author) ?? 'A teacher',
            note: note.text.slice(0, NOTE_PREVIEW),
          },
        }),
      )
      .catch((err) => this.logger.error(`Note push failed: ${err.message}`));
  }

  requireTeam(user: MemberAuth) {
    return this.access.assertHasCapability(
      user.id,
      DepartmentCapability.MANAGE_CHILDREN_CHURCH,
      "Only Children's Church Management workers are authorized to perform this action.",
    );
  }
}
