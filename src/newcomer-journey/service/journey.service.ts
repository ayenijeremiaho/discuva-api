import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { ChurchSettingsService } from '../../church-settings/service/church-settings.service';
import { CacheService } from '../../utility/service/cache.service';

export const JOURNEY_SETTINGS_KEY = 'journey:settings';
const DEFAULT_STUCK_DAYS = 21;
const MAX_CLASS_STEPS = 6;
const DAY_MS = 24 * 3600 * 1000;

export interface JourneySettings {
  // Class types on the path, in order; null means "follow the first class chain".
  classTypeIds: string[] | null;
  // How long someone waits at a step before they show as stuck.
  stuckAfterDays: number;
}

export type StepKey =
  'VISIT' | 'WELCOMED' | 'MEMBER' | `CLASS:${string}` | 'SERVING';

export interface JourneyStep {
  key: StepKey;
  label: string;
  description: string;
}

export type StepStatus = 'DONE' | 'IN_PROGRESS' | 'NEXT' | 'TODO';

// Flags for one person, computed in SQL: which steps they've completed.
const PEOPLE_SQL = (classParam: string) => `
  WITH people AS (
    SELECT ft.id AS first_timer_id, ft.converted_member_id AS member_id, ft.created_at AS started_at,
      ft.firstname, ft.lastname, ft.phone, ft.email
    FROM first_timers ft
    WHERE ft.created_at >= $1 AND ft.created_at < $2
    UNION ALL
    SELECT NULL, m.id, m.created_at, m.firstname, m.lastname, m.phone_number, m.email
    FROM members m
    WHERE m.created_at >= $1 AND m.created_at < $2
      AND NOT EXISTS (SELECT 1 FROM first_timers f WHERE f.converted_member_id = m.id)
  ),
  flags AS (
    SELECT p.*,
      (p.first_timer_id IS NULL OR EXISTS (
        SELECT 1 FROM follow_up_tasks t WHERE t.first_timer_id = p.first_timer_id AND t.status = 'COMPLETED')) AS welcomed,
      (p.member_id IS NOT NULL) AS is_member,
      (p.member_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM worker_profiles wp WHERE wp.member_id = p.member_id AND wp.status = 'ACTIVE')) AS serving,
      COALESCE(cd.done, '{}') AS classes_done
    FROM people p
    LEFT JOIN (
      SELECT e.member_id, array_agg(DISTINCT c.class_type_id::text) AS done
      FROM class_enrollments e
      JOIN church_classes c ON c.id = e.church_class_id
      WHERE e.status = 'COMPLETED' AND c.class_type_id = ANY(${classParam}::uuid[])
      GROUP BY e.member_id
    ) cd ON cd.member_id = p.member_id
  )`;

interface FlagRow {
  first_timer_id: string | null;
  member_id: string | null;
  started_at: Date;
  firstname: string | null;
  lastname: string | null;
  phone: string | null;
  email: string | null;
  welcomed: boolean;
  is_member: boolean;
  serving: boolean;
  classes_done: string[];
}

export function stepDone(
  key: StepKey,
  row: Pick<FlagRow, 'welcomed' | 'is_member' | 'serving' | 'classes_done'>,
): boolean {
  if (key === 'VISIT') return true;
  if (key === 'WELCOMED') return row.welcomed;
  if (key === 'MEMBER') return row.is_member;
  if (key === 'SERVING') return row.serving;
  return row.classes_done.includes(key.slice('CLASS:'.length));
}

// The path a newcomer follows: first visit, welcomed by follow-up, member, the church's classes, serving.
@Injectable()
export class JourneyService {
  constructor(
    @InjectRepository(ChurchSetting)
    private readonly settingRepo: Repository<ChurchSetting>,
    private readonly churchSettings: ChurchSettingsService,
    private readonly cacheService: CacheService,
  ) {}

  async settings(): Promise<JourneySettings> {
    const cached =
      await this.cacheService.get<JourneySettings>(JOURNEY_SETTINGS_KEY);
    if (cached) return cached;
    const row = await this.settingRepo.findOne({
      where: { key: JOURNEY_SETTINGS_KEY },
    });
    const value = (row?.value ?? {}) as Partial<JourneySettings>;
    const settings = {
      classTypeIds: Array.isArray(value.classTypeIds)
        ? value.classTypeIds
        : null,
      stuckAfterDays:
        typeof value.stuckAfterDays === 'number'
          ? value.stuckAfterDays
          : DEFAULT_STUCK_DAYS,
    };
    this.cacheService.set(JOURNEY_SETTINGS_KEY, settings, 600);
    return settings;
  }

  async saveSettings(input: JourneySettings) {
    if (input.classTypeIds && input.classTypeIds.length > MAX_CLASS_STEPS)
      throw new BadRequestException(
        `Up to ${MAX_CLASS_STEPS} classes can be on the path.`,
      );
    if (input.classTypeIds?.length) {
      const known = (await this.settingRepo.query(
        `SELECT id FROM class_types WHERE id = ANY($1::uuid[])`,
        [input.classTypeIds],
      )) as { id: string }[];
      if (known.length !== new Set(input.classTypeIds).size)
        throw new BadRequestException('One of those classes no longer exists.');
    }
    await this.settingRepo.query(
      `INSERT INTO church_settings (key, module_name, value) VALUES ($1, 'Newcomer Journey', $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JOURNEY_SETTINGS_KEY, JSON.stringify(input)],
    );
    this.cacheService.del(JOURNEY_SETTINGS_KEY);
    return this.adminSteps();
  }

  // The steps for this church, leaving out ones whose module is off.
  async steps(): Promise<JourneyStep[]> {
    const [settings, followUp, classes] = await Promise.all([
      this.settings(),
      this.churchSettings.isEnabled('follow_up'),
      this.churchSettings.isEnabled('classes'),
    ]);
    const classTypes = classes
      ? await this.classPath(settings.classTypeIds)
      : [];
    return [
      {
        key: 'VISIT',
        label: 'First visit',
        description: 'Came to a service for the first time.',
      },
      ...(followUp
        ? [
            {
              key: 'WELCOMED' as const,
              label: 'Welcomed',
              description:
                'Someone from the church followed up after the first visit.',
            },
          ]
        : []),
      {
        key: 'MEMBER',
        label: 'Joined the church app',
        description: 'Signed up as a member.',
      },
      ...classTypes.map((c) => ({
        key: `CLASS:${c.id}` as StepKey,
        label: c.name,
        description: c.description ?? '',
      })),
      {
        key: 'SERVING',
        label: 'Serving',
        description: 'Joined a department and serving with a team.',
      },
    ];
  }

  async adminSteps() {
    const [steps, settings] = await Promise.all([
      this.steps(),
      this.settings(),
    ]);
    const classTypes = (await this.settingRepo.query(
      `SELECT id, name FROM class_types WHERE is_active ORDER BY name`,
    )) as { id: string; name: string }[];
    return { steps, settings, classTypes };
  }

  // The member's own journey: what's done, what's under way and the one next thing to do.
  async mine(memberId: string) {
    const steps = await this.steps();
    const classIds = steps
      .filter((s) => s.key.startsWith('CLASS:'))
      .map((s) => s.key.slice(6));
    const rows = (await this.settingRepo.query(
      `SELECT m.created_at, m.serve_interest_at, ft.created_at AS visited_at, ft.id AS first_timer_id,
         (SELECT t.status FROM follow_up_tasks t WHERE t.first_timer_id = ft.id ORDER BY t.created_at LIMIT 1) AS task_status,
         EXISTS (SELECT 1 FROM worker_profiles wp WHERE wp.member_id = m.id AND wp.status = 'ACTIVE') AS serving,
         COALESCE((SELECT json_agg(json_build_object('type', c.class_type_id, 'status', e.status, 'class', c.name, 'at', e.completed_at))
            FROM class_enrollments e JOIN church_classes c ON c.id = e.church_class_id
            WHERE e.member_id = m.id AND c.class_type_id = ANY($2::uuid[]) AND e.status <> 'CANCELLED'), '[]') AS enrollments
       FROM members m
       LEFT JOIN LATERAL (SELECT f.id, f.created_at FROM first_timers f WHERE f.converted_member_id = m.id ORDER BY f.created_at LIMIT 1) ft ON true
       WHERE m.id = $1`,
      [memberId, classIds],
    )) as {
      created_at: Date;
      serve_interest_at: Date | null;
      visited_at: Date | null;
      first_timer_id: string | null;
      task_status: string | null;
      serving: boolean;
      enrollments: {
        type: string;
        status: string;
        class: string;
        at: string | null;
      }[];
    }[];
    const me = rows[0];
    if (!me) throw new NotFoundException('Member not found');

    const nextClasses = classIds.length
      ? ((await this.settingRepo.query(
          `SELECT DISTINCT ON (c.class_type_id) c.class_type_id, c.id, c.name, c.start_date::text AS start_date
           FROM church_classes c
           WHERE c.class_type_id = ANY($1::uuid[]) AND c.status = 'ACTIVE' AND c.open_for_requests
           ORDER BY c.class_type_id, c.start_date NULLS LAST, c.created_at`,
          [classIds],
        )) as {
          class_type_id: string;
          id: string;
          name: string;
          start_date: string | null;
        }[])
      : [];

    let nextMarked = false;
    const journey = steps.map((step) => {
      let status: StepStatus = 'TODO';
      let at: Date | string | null = null;
      let note: string | null = null;
      let action:
        | {
            kind: 'CLASS';
            classId: string | null;
            classTypeId: string;
            className: string | null;
            startDate: string | null;
          }
        | { kind: 'SERVE' }
        | null = null;
      if (step.key === 'VISIT') {
        status = 'DONE';
        at = me.visited_at ?? me.created_at;
      } else if (step.key === 'WELCOMED') {
        if (!me.first_timer_id || me.task_status === 'COMPLETED')
          status = 'DONE';
        else if (me.task_status) {
          status = 'IN_PROGRESS';
          note = 'The follow-up team will be in touch.';
        }
      } else if (step.key === 'MEMBER') {
        status = 'DONE';
        at = me.created_at;
      } else if (step.key === 'SERVING') {
        if (me.serving) status = 'DONE';
        else if (me.serve_interest_at) {
          status = 'IN_PROGRESS';
          note = "You've asked to serve; the church team will reach out.";
        } else action = { kind: 'SERVE' };
      } else {
        const typeId = step.key.slice(6);
        const mineHere = me.enrollments.filter((e) => e.type === typeId);
        const done = mineHere.find((e) => e.status === 'COMPLETED');
        const going = mineHere.find((e) => e.status === 'IN_PROGRESS');
        if (done) {
          status = 'DONE';
          at = done.at;
        } else if (going) {
          status = 'IN_PROGRESS';
          note = `You're in ${going.class}.`;
        } else {
          const next = nextClasses.find((c) => c.class_type_id === typeId);
          action = {
            kind: 'CLASS',
            classTypeId: typeId,
            classId: next?.id ?? null,
            className: next?.name ?? null,
            startDate: next?.start_date ?? null,
          };
        }
      }
      if (status === 'TODO' && !nextMarked) {
        status = 'NEXT';
        nextMarked = true;
      }
      return { ...step, status, at, note, action };
    });
    const done = journey.filter((s) => s.status === 'DONE').length;
    return { steps: journey, done, total: journey.length };
  }

  // For a period: how many who started then have completed each step.
  async funnel(from: Date, to: Date) {
    this.checkRange(from, to);
    const steps = await this.steps();
    const classIds = steps
      .filter((s) => s.key.startsWith('CLASS:'))
      .map((s) => s.key.slice(6));
    const rows = (await this.settingRepo.query(
      `${PEOPLE_SQL('$3')}
       SELECT count(*)::int AS total,
         count(*) FILTER (WHERE welcomed)::int AS welcomed,
         count(*) FILTER (WHERE is_member)::int AS is_member,
         count(*) FILTER (WHERE serving)::int AS serving,
         COALESCE((SELECT json_object_agg(t.id, t.n) FROM (
           SELECT x AS id, count(*)::int AS n FROM flags, unnest(classes_done) x GROUP BY x) t), '{}') AS classes
       FROM flags`,
      [from, to, classIds],
    )) as {
      total: number;
      welcomed: number;
      is_member: number;
      serving: number;
      classes: Record<string, number>;
    }[];
    const r = rows[0];
    const count = (key: StepKey) =>
      key === 'VISIT'
        ? r.total
        : key === 'WELCOMED'
          ? r.welcomed
          : key === 'MEMBER'
            ? r.is_member
            : key === 'SERVING'
              ? r.serving
              : (r.classes[key.slice(6)] ?? 0);
    return {
      total: r.total,
      steps: steps.map((s) => ({
        ...s,
        reached: count(s.key),
        percent: r.total ? Math.round((count(s.key) / r.total) * 100) : 0,
      })),
    };
  }

  // People who finished the step before this one but not this one, waiting longer than the church's threshold.
  async stuck(
    stepKey: string,
    from: Date,
    to: Date,
    page = 1,
    limit = 20,
    now = new Date(),
  ) {
    this.checkRange(from, to);
    const [steps, settings] = await Promise.all([
      this.steps(),
      this.settings(),
    ]);
    const index = steps.findIndex((s) => s.key === stepKey);
    if (index <= 0)
      throw new BadRequestException('Pick a step after the first visit.');
    const step = steps[index];
    const classIds = steps
      .filter((s) => s.key.startsWith('CLASS:'))
      .map((s) => s.key.slice(6));
    const size = Math.min(Math.max(limit, 1), 100);
    const params: unknown[] = [
      from,
      to,
      classIds,
      new Date(now.getTime() - settings.stuckAfterDays * DAY_MS),
    ];
    const condition = (key: StepKey) => {
      if (key === 'VISIT') return 'true';
      if (key === 'WELCOMED') return 'welcomed';
      if (key === 'MEMBER') return 'is_member';
      if (key === 'SERVING') return 'serving';
      params.push(key.slice(6));
      return `$${params.length}::text = ANY(classes_done)`;
    };
    const where = `(${condition(steps[index - 1].key)}) AND NOT (${condition(step.key)})`;
    params.push(size, (Math.max(page, 1) - 1) * size);
    const rows = (await this.settingRepo.query(
      `${PEOPLE_SQL('$3')}
       SELECT *, count(*) OVER()::int AS total FROM flags
       WHERE ${where} AND started_at < $4
       ORDER BY started_at
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )) as (FlagRow & { total: number })[];
    return this.stuckResult(step, rows, page, size, now);
  }

  private stuckResult(
    step: JourneyStep,
    rows: (FlagRow & { total: number })[],
    page: number,
    limit: number,
    now: Date,
  ) {
    return {
      step,
      total: rows[0]?.total ?? 0,
      page: Math.max(page, 1),
      limit,
      people: rows.map((r) => ({
        name: `${r.firstname ?? ''} ${r.lastname ?? ''}`.trim() || 'Unknown',
        phone: r.phone,
        email: r.email,
        firstTimerId: r.first_timer_id,
        memberId: r.member_id,
        startedAt: r.started_at,
        daysSinceStart: Math.floor(
          (now.getTime() - new Date(r.started_at).getTime()) / DAY_MS,
        ),
      })),
    };
  }

  // The configured classes; by default the church's linked class chain, or failing that its earliest class.
  private async classPath(classTypeIds: string[] | null) {
    const types = (await this.settingRepo.query(
      `SELECT id, name, description, next_class_type_id, is_active FROM class_types ORDER BY created_at, name`,
    )) as {
      id: string;
      name: string;
      description: string | null;
      next_class_type_id: string | null;
      is_active: boolean;
    }[];
    const byId = new Map(types.map((t) => [t.id, t]));
    if (classTypeIds)
      return classTypeIds
        .map((id) => byId.get(id))
        .filter((t): t is NonNullable<typeof t> => !!t);
    const pointedTo = new Set(
      types.map((t) => t.next_class_type_id).filter(Boolean),
    );
    const active = types.filter((t) => t.is_active && !pointedTo.has(t.id));
    const start =
      active.find((t) => t.next_class_type_id) ??
      active[0] ??
      types.find((t) => t.is_active);
    const path: typeof types = [];
    const seen = new Set<string>();
    let t = start;
    while (t && !seen.has(t.id) && path.length < MAX_CLASS_STEPS) {
      seen.add(t.id);
      if (t.is_active) path.push(t);
      t = t.next_class_type_id ? byId.get(t.next_class_type_id) : undefined;
    }
    return path;
  }

  private checkRange(from: Date, to: Date) {
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from >= to
    )
      throw new BadRequestException('Pick a valid date range.');
    if (to.getTime() - from.getTime() > 3 * 366 * DAY_MS)
      throw new BadRequestException('Pick a range of up to three years.');
  }
}
