import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Member } from '../../member/entity/member.entity';
import { RecipientDetails, recipientVars } from '../recipient';

type Row = RecipientDetails & { id: string };

// Looks up recipient details only when church wording asks for them.
@Injectable()
export class NotificationRecipientService {
  constructor(
    @InjectRepository(Member)
    private readonly members: Repository<Member>,
  ) {}

  async byEmail(email: string): Promise<Record<string, string>> {
    const [row] = await this.query()
      .where('LOWER(m.email) = LOWER(:email)', { email })
      .limit(1)
      .getRawMany<Row>();
    return recipientVars(row);
  }

  async byMemberIds(
    ids: string[],
  ): Promise<Map<string, Record<string, string>>> {
    if (!ids.length) return new Map();
    const rows = await this.query()
      .where('m.id IN (:...ids)', { ids })
      .getRawMany<Row>();
    return new Map(rows.map((row) => [row.id, recipientVars(row)]));
  }

  private query() {
    return this.members
      .createQueryBuilder('m')
      .leftJoin('m.workerProfile', 'wp')
      .leftJoin('wp.department', 'd')
      .select([
        'm.id AS id',
        'm.firstname AS firstname',
        'm.lastname AS lastname',
        'm.email AS email',
        'm.phone_number AS "phoneNumber"',
        'm.gender AS gender',
        'm.marital_status AS "maritalStatus"',
        'd.name AS department',
      ]);
  }
}
