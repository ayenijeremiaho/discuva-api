import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { RecipientDetails, recipientVars } from '../recipient';
import { queryTenant } from '../../tenant/utility/query-tenant';

type Row = RecipientDetails & { id: string };

// Looks up recipient details only when church wording asks for them.
@Injectable()
export class NotificationRecipientService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async byEmail(email: string): Promise<Record<string, string>> {
    const [row] = await this.query('LOWER(m.email) = LOWER($1) LIMIT 1', [
      email,
    ]);
    return recipientVars(row);
  }

  async byMemberIds(
    ids: string[],
  ): Promise<Map<string, Record<string, string>>> {
    if (!ids.length) return new Map();
    const rows = await this.query('m.id = ANY($1::uuid[])', [ids]);
    return new Map(rows.map((row) => [row.id, recipientVars(row)]));
  }

  private query(where: string, params: unknown[]): Promise<Row[]> {
    return queryTenant<Row>(
      this.dataSource,
      this.cls.get('schemaName'),
      (s) => `SELECT m.id, m.firstname, m.lastname, m.email,
          m.phone_number AS "phoneNumber", m.gender,
          m.marital_status AS "maritalStatus", d.name AS department
        FROM ${s}.members m
        LEFT JOIN ${s}.worker_profiles wp ON wp.member_id = m.id
        LEFT JOIN ${s}.departments d ON d.id = wp.department_id
        WHERE ${where}`,
      params,
    );
  }
}
