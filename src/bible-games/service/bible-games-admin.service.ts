import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { format, startOfMonth } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { BibleGameCustomQuestion } from '../entity/bible-game-custom-question.entity';
import { BibleGameHidden } from '../entity/bible-game-hidden.entity';
import {
  CustomQuestionDto,
  HideQuestionDto,
  UpdateCustomQuestionDto,
} from '../dto/bible-game.dto';
import { KIND_LABEL, Question, refsInKey } from '../engine/questions';
import { LEVEL_COUNT, levelSpec } from '../engine/levels';
import { buildRound } from '../engine/round';
import { seededRng } from '../engine/rng';
import { label } from '../engine/bible';
import { BibleGamesService, CONTENT_CACHE } from './bible-games.service';
import { ChurchTimezoneService } from '../../event/service/church-timezone.service';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

const PREVIEW_COUNT = 12;

export interface PreviewQuestion {
  key: string;
  kind: string;
  kindLabel: string;
  prompt: string;
  passage?: string;
  ref?: string;
  options: string[];
  answer: number;
  explain: string;
  verses: { ref: string; label: string }[];
  hidden: boolean;
  // What hides it: the question's own key or "verse:REF". Removing that shows it again.
  hiddenBy: string | null;
}

@Injectable()
export class BibleGamesAdminService {
  constructor(
    @InjectRepository(BibleGameCustomQuestion)
    private readonly customRepo: Repository<BibleGameCustomQuestion>,
    @InjectRepository(BibleGameHidden)
    private readonly hiddenRepo: Repository<BibleGameHidden>,
    private readonly games: BibleGamesService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly cacheService: CacheService,
    private readonly auditLog: AuditLogService,
  ) {}

  // Small summary from the running-total tables and indexed lookups only.
  async stats() {
    const timezone = await this.churchTimezone.get();
    const local = toZonedTime(new Date(), timezone);
    const month = format(startOfMonth(local), 'yyyy-MM-dd');
    const today = format(local, 'yyyy-MM-dd');
    const [[totals], [daily], levels] = await Promise.all([
      this.txHost.tx.query(
        `SELECT
           (SELECT COUNT(*)::int FROM bible_game_monthly WHERE month = $1 AND points > 0) AS "playersThisMonth",
           (SELECT COALESCE(SUM(points), 0)::int FROM bible_game_monthly WHERE month = $1) AS "pointsThisMonth",
           (SELECT COUNT(*)::int FROM bible_game_progress WHERE points_total > 0) AS "playersAllTime"`,
        [month],
      ) as Promise<
        {
          playersThisMonth: number;
          pointsThisMonth: number;
          playersAllTime: number;
        }[]
      >,
      this.txHost.tx.query(
        `SELECT COUNT(*)::int AS players FROM bible_game_rounds WHERE mode = 'daily' AND period_key = $1`,
        [today],
      ) as Promise<{ players: number }[]>,
      this.txHost.tx.query(
        `SELECT highest_passed AS level, COUNT(*)::int AS players
         FROM bible_game_progress WHERE points_total > 0
         GROUP BY highest_passed ORDER BY highest_passed`,
      ) as Promise<{ level: number; players: number }[]>,
    ]);
    return { ...totals, dailyPlayersToday: daily?.players ?? 0, levels };
  }

  // A sample of what a level asks, with answers, so admins can spot and hide anything unsuitable.
  async preview(level: number, seed = 0): Promise<PreviewQuestion[]> {
    const { hidden } = await this.games.content();
    const questions = buildRound(
      seededRng(`preview:${level}:${seed}`),
      levelSpec(level),
      PREVIEW_COUNT,
    );
    return questions.map((q) => this.toPreview(q, hidden));
  }

  async hiddenList() {
    const rows = await this.hiddenRepo.find({ order: { createdAt: 'DESC' } });
    return rows.map((h) => ({
      key: h.key,
      label: h.label,
      wholeVerse: h.key.startsWith('verse:'),
      verse: h.key.startsWith('verse:') ? label(h.key.slice(6)) : null,
      createdAt: h.createdAt,
    }));
  }

  async hide(dto: HideQuestionDto, adminId: string) {
    await this.hiddenRepo.save(
      this.hiddenRepo.create({
        key: dto.key,
        label: dto.label ?? null,
        hiddenByAdminId: adminId,
      }),
    );
    this.forgetContent();
    this.auditLog.log('BIBLE_GAME_QUESTION_HIDDEN', {
      actorId: adminId,
      targetName: dto.key,
      metadata: { key: dto.key },
    });
    return { key: dto.key };
  }

  async unhide(key: string, adminId: string) {
    const result = await this.hiddenRepo.delete({ key });
    if (!result.affected)
      throw new NotFoundException('That question is not hidden.');
    this.forgetContent();
    this.auditLog.log('BIBLE_GAME_QUESTION_UNHIDDEN', {
      actorId: adminId,
      targetName: key,
      metadata: { key },
    });
  }

  listCustom() {
    return this.customRepo.find({ order: { createdAt: 'DESC' } });
  }

  async createCustom(dto: CustomQuestionDto, adminId: string) {
    const levels = this.levels(dto.levelMin, dto.levelMax);
    this.checkAnswer(dto.options, dto.answer);
    const saved = await this.customRepo.save(
      this.customRepo.create({
        prompt: dto.prompt.trim(),
        options: dto.options.map((o) => o.trim()),
        answer: dto.answer,
        explain: dto.explain?.trim() || null,
        ...levels,
        active: dto.active ?? true,
        createdByAdminId: adminId,
      }),
    );
    this.forgetContent();
    this.auditLog.log('BIBLE_GAME_QUESTION_CREATED', {
      actorId: adminId,
      targetId: saved.id,
      targetName: saved.prompt,
    });
    return saved;
  }

  async updateCustom(
    id: string,
    dto: UpdateCustomQuestionDto,
    adminId: string,
  ) {
    const q = await this.customRepo.findOne({ where: { id } });
    if (!q) throw new NotFoundException('Question not found');
    const options = dto.options?.map((o) => o.trim()) ?? q.options;
    const answer = dto.answer ?? q.answer;
    this.checkAnswer(options, answer);
    Object.assign(q, {
      prompt: dto.prompt?.trim() ?? q.prompt,
      options,
      answer,
      explain:
        dto.explain !== undefined ? dto.explain?.trim() || null : q.explain,
      ...this.levels(dto.levelMin ?? q.levelMin, dto.levelMax ?? q.levelMax),
      active: dto.active ?? q.active,
    });
    const saved = await this.customRepo.save(q);
    this.forgetContent();
    this.auditLog.log('BIBLE_GAME_QUESTION_UPDATED', {
      actorId: adminId,
      targetId: id,
      targetName: saved.prompt,
    });
    return saved;
  }

  async deleteCustom(id: string, adminId: string) {
    const result = await this.customRepo.delete({ id });
    if (!result.affected) throw new NotFoundException('Question not found');
    this.forgetContent();
    this.auditLog.log('BIBLE_GAME_QUESTION_DELETED', {
      actorId: adminId,
      targetId: id,
    });
  }

  private toPreview(q: Question, hidden: ReadonlySet<string>): PreviewQuestion {
    return {
      key: q.key,
      kind: q.kind,
      kindLabel: KIND_LABEL[q.kind],
      prompt: q.prompt,
      ...(q.passage ? { passage: q.passage } : {}),
      ...(q.ref ? { ref: q.ref } : {}),
      options: q.options,
      answer: q.answer,
      explain: q.explain,
      verses: refsInKey(q.key).map((r) => ({ ref: r, label: label(r) })),
      hidden: this.games.isHidden(q, hidden),
      hiddenBy: hidden.has(q.key)
        ? q.key
        : (refsInKey(q.key)
            .map((r) => `verse:${r}`)
            .find((k) => hidden.has(k)) ?? null),
    };
  }

  private levels(min = 1, max = LEVEL_COUNT) {
    if (min > max)
      throw new BadRequestException(
        'The lowest level must not be above the highest.',
      );
    return { levelMin: min, levelMax: max };
  }

  private checkAnswer(options: string[], answer: number) {
    if (answer >= options.length)
      throw new BadRequestException('Pick which option is the right answer.');
  }

  private forgetContent() {
    this.cacheService.del(this.cacheService.key(CONTENT_CACHE, 'all'));
  }
}
