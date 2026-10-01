import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { ChurchClass } from '../entity/church-class.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { ClassType } from '../entity/class-type.entity';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';
import {
  ClassProgressService,
  EnrollmentProgress,
} from './class-progress.service';
import { ClassReportQueryDto } from '../dto/class-report.dto';

export interface ClassReportRow {
  classId: string;
  className: string;
  classTypeName: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  enrolled: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  // completed ÷ everyone who enrolled (including cancelled), as a percentage.
  completionRate: number | null;
  sessionsHeld: number;
  // Average of each person's attendance %, among people with at least one session held.
  averageAttendance: number | null;
  certificatesIssued: number;
}

export interface PipelineRow {
  classTypeId: string;
  classTypeName: string;
  nextClassTypeName: string;
  completed: number;
  movedOn: number;
  rate: number | null;
}

const pct = (num: number, den: number) =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : null;

@Injectable()
export class ClassReportService {
  constructor(
    @InjectRepository(ChurchClass)
    private readonly classRepo: Repository<ChurchClass>,
    @InjectRepository(ClassEnrollment)
    private readonly enrollmentRepo: Repository<ClassEnrollment>,
    @InjectRepository(ClassType)
    private readonly classTypeRepo: Repository<ClassType>,
    private readonly progress: ClassProgressService,
  ) {}

  // Classes running at any point in [from, to] (open-ended dates count as running).
  private async classesInRange(query: ClassReportQueryDto) {
    const qb = this.classRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.classType', 'classType')
      .orderBy('c.startDate', 'DESC', 'NULLS LAST')
      .addOrderBy('c.createdAt', 'DESC');
    if (query.to)
      qb.andWhere('(c.start_date IS NULL OR c.start_date <= :to)', {
        to: query.to,
      });
    if (query.from)
      qb.andWhere('(c.end_date IS NULL OR c.end_date >= :from)', {
        from: query.from,
      });
    if (query.classTypeId)
      qb.andWhere('classType.id = :classTypeId', {
        classTypeId: query.classTypeId,
      });
    return qb.getMany();
  }

  async summary(query: ClassReportQueryDto) {
    const { progressByClass: _detail, ...report } = await this.build(query);
    return report;
  }

  private async build(query: ClassReportQueryDto) {
    const classes = await this.classesInRange(query);
    const progressByClass = new Map<
      string,
      { sessionsHeld: number; people: EnrollmentProgress[] }
    >();
    for (const [id, p] of await this.progress.progressFor(
      classes.map((c) => c.id),
    ))
      progressByClass.set(id, p);
    const counts = classes.length
      ? await this.enrollmentRepo
          .createQueryBuilder('e')
          .select('e.church_class_id', 'classId')
          .addSelect('e.status', 'status')
          .addSelect('COUNT(*)', 'count')
          .addSelect(
            'SUM(CASE WHEN e.certificate_issued THEN 1 ELSE 0 END)',
            'certificates',
          )
          .where('e.church_class_id IN (:...ids)', {
            ids: classes.map((c) => c.id),
          })
          .groupBy('e.church_class_id')
          .addGroupBy('e.status')
          .getRawMany<{
            classId: string;
            status: EnrollmentStatusEnum;
            count: string;
            certificates: string;
          }>()
      : [];

    const rows: ClassReportRow[] = classes.map((c) => {
      const own = counts.filter((r) => r.classId === c.id);
      const n = (st: EnrollmentStatusEnum) =>
        Number(own.find((r) => r.status === st)?.count ?? 0);
      const inProgress = n(EnrollmentStatusEnum.IN_PROGRESS);
      const completed = n(EnrollmentStatusEnum.COMPLETED);
      const cancelled = n(EnrollmentStatusEnum.CANCELLED);
      const p = progressByClass.get(c.id)!;
      const rates = p.people
        .map((x) => x.attendancePercent)
        .filter((x): x is number => x !== null);
      return {
        classId: c.id,
        className: c.name,
        classTypeName: c.classType?.name ?? null,
        status: c.status,
        startDate: c.startDate,
        endDate: c.endDate,
        enrolled: inProgress + completed + cancelled,
        inProgress,
        completed,
        cancelled,
        completionRate: pct(completed, inProgress + completed + cancelled),
        sessionsHeld: p.sessionsHeld,
        averageAttendance: rates.length
          ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) /
            10
          : null,
        certificatesIssued: own.reduce(
          (sum, r) => sum + Number(r.certificates ?? 0),
          0,
        ),
      };
    });

    const totals = rows.reduce(
      (t, r) => ({
        classes: t.classes + 1,
        enrolled: t.enrolled + r.enrolled,
        inProgress: t.inProgress + r.inProgress,
        completed: t.completed + r.completed,
        cancelled: t.cancelled + r.cancelled,
        certificatesIssued: t.certificatesIssued + r.certificatesIssued,
      }),
      {
        classes: 0,
        enrolled: 0,
        inProgress: 0,
        completed: 0,
        cancelled: 0,
        certificatesIssued: 0,
      },
    );

    return {
      from: query.from ?? null,
      to: query.to ?? null,
      totals: {
        ...totals,
        completionRate: pct(totals.completed, totals.enrolled),
      },
      classes: rows,
      pipeline: await this.pipeline(query),
      progressByClass,
    };
  }

  // For each class type that leads to another: of the members who completed it, how many enrolled in the next one.
  async pipeline(query: ClassReportQueryDto): Promise<PipelineRow[]> {
    const types = await this.classTypeRepo.find({
      relations: ['nextClassType'],
      order: { name: 'ASC' },
    });
    const out: PipelineRow[] = [];
    for (const t of types) {
      if (!t.nextClassType) continue;
      if (query.classTypeId && query.classTypeId !== t.id) continue;
      // Completers and how many of them have a live enrollment in the next type, in one query.
      const params: unknown[] = [
        t.id,
        EnrollmentStatusEnum.COMPLETED,
        t.nextClassType.id,
        EnrollmentStatusEnum.CANCELLED,
      ];
      let range = '';
      if (query.from) {
        params.push(query.from);
        range += ` AND e.completed_at >= $${params.length}`;
      }
      if (query.to) {
        params.push(query.to);
        range += ` AND e.completed_at < ($${params.length}::date + interval '1 day')`;
      }
      const [row]: { completed: string; moved: string }[] =
        await this.enrollmentRepo.query(
          `WITH completers AS (
             SELECT DISTINCT e.member_id
             FROM class_enrollments e
             JOIN church_classes c ON c.id = e.church_class_id
             WHERE c.class_type_id = $1 AND e.status = $2 AND e.member_id IS NOT NULL${range}
           )
           SELECT
             (SELECT COUNT(*) FROM completers) AS completed,
             (SELECT COUNT(DISTINCT n.member_id)
                FROM class_enrollments n
                JOIN church_classes nc ON nc.id = n.church_class_id
                WHERE nc.class_type_id = $3 AND n.status != $4
                  AND n.member_id IN (SELECT member_id FROM completers)) AS moved`,
          params,
        );
      const completed = Number(row?.completed ?? 0);
      const movedOn = Number(row?.moved ?? 0);
      out.push({
        classTypeId: t.id,
        classTypeName: t.name,
        nextClassTypeName: t.nextClassType.name,
        completed,
        movedOn,
        rate: pct(movedOn, completed),
      });
    }
    return out;
  }

  async exportWorkbook(query: ClassReportQueryDto): Promise<Buffer> {
    const report = await this.build(query);
    const pc = (v: number | null) => (v === null ? '' : `${v}%`);
    const workbook = new ExcelJS.Workbook();
    const sheet = (
      title: string,
      columns: { header: string; key: string; width?: number }[],
      rows: Record<string, unknown>[],
    ) => {
      const ws = workbook.addWorksheet(title);
      ws.columns = columns.map((c) => ({ ...c, width: c.width ?? 16 }));
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEADCC9' },
      };
      rows.forEach((r) => ws.addRow(r));
    };
    sheet(
      'Classes',
      [
        { header: 'Class', key: 'className', width: 30 },
        { header: 'Type', key: 'classTypeName', width: 22 },
        { header: 'Status', key: 'status' },
        { header: 'Starts', key: 'startDate', width: 12 },
        { header: 'Ends', key: 'endDate', width: 12 },
        { header: 'Enrolled', key: 'enrolled' },
        { header: 'In progress', key: 'inProgress' },
        { header: 'Completed', key: 'completed' },
        { header: 'Cancelled', key: 'cancelled' },
        { header: 'Completion rate', key: 'completionRate' },
        { header: 'Sessions held', key: 'sessionsHeld' },
        { header: 'Average attendance', key: 'averageAttendance' },
        { header: 'Certificates', key: 'certificatesIssued' },
      ],
      report.classes.map((r) => ({
        ...r,
        completionRate: pc(r.completionRate),
        averageAttendance: pc(r.averageAttendance),
      })),
    );
    sheet(
      'Next steps',
      [
        { header: 'Completed', key: 'classTypeName', width: 26 },
        { header: 'Next class', key: 'nextClassTypeName', width: 26 },
        { header: 'People who completed', key: 'completed', width: 20 },
        { header: 'Enrolled in next class', key: 'movedOn', width: 22 },
        { header: 'Rate', key: 'rate' },
      ],
      report.pipeline.map((r) => ({ ...r, rate: pc(r.rate) })),
    );
    const people = report.classes.flatMap((c) =>
      report.progressByClass.get(c.classId)!.people.map((p) => ({
        className: c.className,
        name: p.name,
        email: p.email ?? '',
        status: p.status,
        attendance: pc(p.attendancePercent),
        sessions: `${p.present}/${p.sessionsHeld}`,
        assignments: `${p.assignmentsSubmitted}/${p.assignmentsTotal}`,
        score: pc(p.averageScorePercent),
        certificate: p.certificateIssued ? 'Yes' : '',
      })),
    );
    sheet(
      'People',
      [
        { header: 'Class', key: 'className', width: 30 },
        { header: 'Name', key: 'name', width: 26 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Attendance', key: 'attendance' },
        { header: 'Present / held', key: 'sessions' },
        { header: 'Assignments', key: 'assignments' },
        { header: 'Average score', key: 'score' },
        { header: 'Certificate', key: 'certificate' },
      ],
      people,
    );
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
