import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from '../../utility/service/audit-log.service';
import {
  SharedSpace,
  SharedSpaceAudienceEnum,
} from '../entity/shared-space.entity';
import { TeamSpace, TeamSpaceKindEnum } from '../entity/team-space.entity';
import { SaveSharedSpaceDto } from '../dto/team-space.dto';
import { TeamSpaceAccessService } from './team-space-access.service';

const NAME_SQL = `NULLIF(TRIM(COALESCE(m.firstname, '') || ' ' || COALESCE(m.lastname, '')), '')`;

interface SourceRow {
  shared_space_id: string;
  kind: string;
  ref_id: string;
  name: string;
}

interface PersonRow {
  shared_space_id: string;
  member_id: string;
  is_leader: boolean;
  name: string | null;
}

@Injectable()
export class SharedSpaceService {
  constructor(
    @InjectRepository(SharedSpace)
    private readonly sharedRepo: Repository<SharedSpace>,
    @InjectRepository(TeamSpace)
    private readonly spaceRepo: Repository<TeamSpace>,
    private readonly access: TeamSpaceAccessService,
    private readonly audit: AuditLogService,
  ) {}

  // Reference data an admin controls, so the full list. Three queries however many spaces there are.
  async list() {
    const spaces = await this.sharedRepo.find({
      order: { archivedAt: { direction: 'DESC', nulls: 'FIRST' }, name: 'ASC' },
    });
    if (!spaces.length) return [];
    const ids = spaces.map((s) => s.id);
    const [sources, people, rooms] = await Promise.all([
      this.sharedRepo.query(
        `SELECT s.shared_space_id, s.kind, s.ref_id, COALESCE(d.name, g.name) AS name
         FROM shared_space_sources s
         LEFT JOIN departments d ON s.kind = 'DEPARTMENT' AND d.id = s.ref_id
         LEFT JOIN small_groups g ON s.kind = 'FELLOWSHIP' AND g.id = s.ref_id
         WHERE s.shared_space_id = ANY($1)`,
        [ids],
      ) as Promise<SourceRow[]>,
      this.sharedRepo.query(
        `SELECT p.shared_space_id, p.member_id, p.is_leader, ${NAME_SQL} AS name
         FROM shared_space_people p JOIN members m ON m.id = p.member_id
         WHERE p.shared_space_id = ANY($1) ORDER BY p.is_leader DESC, name`,
        [ids],
      ) as Promise<PersonRow[]>,
      this.spaceRepo.find({
        where: ids.map((refId) => ({
          kind: TeamSpaceKindEnum.SHARED,
          refId,
        })),
      }),
    ]);
    const leadersOnly = new Map(rooms.map((r) => [r.refId, r.leadersOnly]));
    return spaces.map((s) => ({
      id: s.id,
      name: s.name,
      audience: s.audience,
      archivedAt: s.archivedAt,
      leadersOnly: leadersOnly.get(s.id) ?? false,
      teams: sources
        .filter((t) => t.shared_space_id === s.id && t.name)
        .map((t) => ({ kind: t.kind, id: t.ref_id, name: t.name })),
      people: people
        .filter((p) => p.shared_space_id === s.id)
        .map((p) => ({
          id: p.member_id,
          name: p.name,
          isLeader: p.is_leader,
        })),
    }));
  }

  async create(dto: SaveSharedSpaceDto, actorId?: string) {
    this.assertHasPeople(dto);
    const saved = await this.sharedRepo.save(
      this.sharedRepo.create({ name: dto.name, audience: dto.audience }),
    );
    await this.saveDetails(saved.id, dto);
    this.audit.log('SHARED_SPACE_CREATED', {
      actorId,
      targetId: saved.id,
      targetName: saved.name,
    });
    return { id: saved.id };
  }

  async update(id: string, dto: SaveSharedSpaceDto, actorId?: string) {
    this.assertHasPeople(dto);
    const space = await this.find(id);
    await this.sharedRepo.update(space.id, {
      name: dto.name,
      audience: dto.audience,
    });
    await this.saveDetails(space.id, dto);
    this.audit.log('SHARED_SPACE_UPDATED', {
      actorId,
      targetId: id,
      targetName: dto.name,
    });
    return { id };
  }

  // Keeps the conversation. People just stop seeing it until it's restored.
  async setArchived(id: string, archived: boolean, actorId?: string) {
    await this.find(id);
    await this.sharedRepo.update(id, {
      archivedAt: archived ? new Date() : null,
    });
    this.audit.log(
      archived ? 'SHARED_SPACE_ARCHIVED' : 'SHARED_SPACE_RESTORED',
      { actorId, targetId: id },
    );
    return { id };
  }

  private assertHasPeople(dto: SaveSharedSpaceDto): void {
    if (!dto.leaderIds.length) {
      throw new BadRequestException('Choose at least one leader.');
    }
    if (
      dto.audience === SharedSpaceAudienceEnum.CUSTOM &&
      !dto.departmentIds.length &&
      !dto.groupIds.length &&
      !dto.memberIds.length
    ) {
      throw new BadRequestException('Choose who this space is for.');
    }
  }

  private async find(id: string): Promise<SharedSpace> {
    const space = await this.sharedRepo.findOneBy({ id });
    if (!space) throw new NotFoundException('Space not found');
    return space;
  }

  private async saveDetails(
    id: string,
    dto: SaveSharedSpaceDto,
  ): Promise<void> {
    const custom = dto.audience === SharedSpaceAudienceEnum.CUSTOM;
    const leaders = new Set(dto.leaderIds);
    const people = [
      ...new Set([...dto.leaderIds, ...(custom ? dto.memberIds : [])]),
    ];
    await this.sharedRepo.query(
      `DELETE FROM shared_space_sources WHERE shared_space_id = $1`,
      [id],
    );
    await this.sharedRepo.query(
      `DELETE FROM shared_space_people WHERE shared_space_id = $1`,
      [id],
    );
    if (custom) {
      await this.sharedRepo.query(
        `INSERT INTO shared_space_sources (shared_space_id, kind, ref_id)
         SELECT $1::uuid, 'DEPARTMENT'::varchar, d.id FROM departments d WHERE d.id = ANY($2::uuid[])
         UNION ALL
         SELECT $1::uuid, 'FELLOWSHIP'::varchar, g.id FROM small_groups g WHERE g.id = ANY($3::uuid[])`,
        [id, dto.departmentIds, dto.groupIds],
      );
    }
    await this.sharedRepo.query(
      `INSERT INTO shared_space_people (shared_space_id, member_id, is_leader)
       SELECT $1::uuid, m.id, m.id = ANY($3::uuid[]) FROM members m WHERE m.id = ANY($2::uuid[])`,
      [id, people, [...leaders]],
    );
    const room = await this.access.ensureSpace(TeamSpaceKindEnum.SHARED, id);
    await this.spaceRepo.update(room.id, { leadersOnly: dto.leadersOnly });
  }
}
