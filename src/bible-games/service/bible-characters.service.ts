import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BibleCharacterReview } from '../entity/bible-character-review.entity';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import {
  BibleCharacter,
  CHARACTER_QUESTIONS,
  QUESTION_GROUPS,
  QuestionGroup,
  characterData,
  matchTerms,
  mentions,
} from '../engine/characters';
import { BOOK, label, parseRef, verse } from '../engine/bible';
import { UpdateBibleCharacterDto } from '../dto/bible-game.dto';
import { DEFAULT_TURN_HOURS, TURN_HOURS_OPTIONS } from '../engine/duel';

const SETTINGS_KEY = 'bible_characters:settings';
const CACHE_KEY = 'bible-characters';
const CACHE_TTL_SECONDS = 300;

export interface BibleCharacterSettings {
  // Off (default) = every character not hidden is in play, reviewed or not.
  onlyReviewed: boolean;
  // How long a duel player has to accept or take their turn.
  turnHours: number;
}

interface ReviewState {
  characterId: string;
  hidden: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  summaryOverride: string | null;
  cluesOverride: string[] | null;
}

type Named = { id: string; name: string };

export interface AdminCharacterView {
  id: string;
  name: string;
  otherNames: string[];
  testament: string;
  gender: string;
  difficulty: string;
  summary: string;
  originalSummary: string;
  clues: { ref: string; label: string; text: string }[];
  originalClues: string[];
  books: { code: string; name: string }[];
  family: {
    father: Named | null;
    mother: Named | null;
    spouses: Named[];
    children: Named[];
    siblings: Named[];
  };
  // What the game will answer "yes" to, so a reviewer can check every claim.
  yes: { group: QuestionGroup; text: string }[];
  hidden: boolean;
  edited: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface AdminCharacterList {
  characters: AdminCharacterView[];
  total: number;
  reviewed: number;
  hidden: number;
  settings: BibleCharacterSettings;
  groups: { id: QuestionGroup; label: string }[];
}

// A character as the game uses it: the shipped details with this church's summary and clues.
export type PlayableCharacter = BibleCharacter;

@Injectable()
export class BibleCharactersService {
  constructor(
    @InjectRepository(BibleCharacterReview)
    private readonly reviewRepo: Repository<BibleCharacterReview>,
    @InjectRepository(ChurchSetting)
    private readonly settingRepo: Repository<ChurchSetting>,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async adminList(): Promise<AdminCharacterList> {
    const { list, byId } = characterData();
    const [reviews, settings] = await Promise.all([
      this.reviews(),
      this.settings(),
    ]);
    const named = (id?: string): Named | null => {
      const c = id ? byId.get(id) : undefined;
      return c ? { id: c.id, name: c.name } : null;
    };
    const many = (ids?: string[]) =>
      (ids ?? []).flatMap((id) => named(id) ?? []);

    const characters = list.map((c): AdminCharacterView => {
      const r = reviews.get(c.id);
      const clues = r?.cluesOverride ?? c.clues;
      return {
        id: c.id,
        name: c.name,
        otherNames: c.otherNames ?? [],
        testament: c.testament,
        gender: c.gender,
        difficulty: c.difficulty,
        summary: r?.summaryOverride ?? c.summary,
        originalSummary: c.summary,
        clues: clues.map((ref) => ({
          ref,
          label: label(ref),
          text: verse(ref)?.text ?? '',
        })),
        originalClues: c.clues,
        books: c.books.map((code) => ({
          code,
          name: BOOK.get(code)?.name ?? code,
        })),
        family: {
          father: named(c.father),
          mother: named(c.mother),
          spouses: many(c.spouses),
          children: many(c.children),
          siblings: many(c.siblings),
        },
        yes: CHARACTER_QUESTIONS.filter((q) => q.test(c, byId)).map((q) => ({
          group: q.group,
          text: q.text,
        })),
        hidden: r?.hidden ?? false,
        edited: !!(r?.summaryOverride || r?.cluesOverride),
        reviewedAt: r?.reviewedAt ?? null,
        reviewedBy: r?.reviewedBy ?? null,
      };
    });
    return {
      characters,
      total: characters.length,
      reviewed: characters.filter((c) => c.reviewedAt).length,
      hidden: characters.filter((c) => c.hidden).length,
      settings,
      groups: QUESTION_GROUPS,
    };
  }

  async update(
    id: string,
    dto: UpdateBibleCharacterDto,
    admin: Admin,
  ): Promise<AdminCharacterView> {
    const character = characterData().byId.get(id);
    if (!character) throw new NotFoundException('Character not found');
    if (
      dto.summary !== undefined &&
      dto.summary !== null &&
      !dto.summary.trim()
    )
      throw new BadRequestException('A summary cannot be empty');
    const clues = dto.clues ? this.parseClues(character, dto.clues) : dto.clues;

    const row =
      (await this.reviewRepo.findOne({ where: { characterId: id } })) ??
      this.reviewRepo.create({ characterId: id, hidden: false });
    if (dto.hidden !== undefined) row.hidden = dto.hidden;
    if (dto.reviewed !== undefined) {
      row.reviewedBy = dto.reviewed ? admin : null;
      row.reviewedAt = dto.reviewed ? new Date() : null;
    }
    if (dto.summary !== undefined) {
      const summary = dto.summary?.trim() ?? null;
      row.summaryOverride = summary === character.summary ? null : summary;
    }
    if (clues !== undefined) {
      const same = clues && clues.join() === character.clues.join();
      row.cluesOverride = clues && !same ? clues : null;
    }
    row.updatedBy = admin;
    await this.reviewRepo.save(row);
    this.cacheService.del(this.cacheService.key(CACHE_KEY, 'reviews'));
    this.auditLogService.log('BIBLE_CHARACTER_UPDATED', {
      actorId: admin.member?.id,
      targetId: id,
      targetName: character.name,
      metadata: { changes: Object.keys(dto) },
    });

    const view = (await this.adminList()).characters.find((c) => c.id === id);
    return view!;
  }

  async settings(): Promise<BibleCharacterSettings> {
    const key = this.cacheService.key(CACHE_KEY, 'settings');
    const cached = await this.cacheService.get<BibleCharacterSettings>(key);
    if (cached !== undefined) return cached;
    const row = await this.settingRepo.findOne({
      where: { key: SETTINGS_KEY },
    });
    const stored = (row?.value ?? {}) as Partial<BibleCharacterSettings>;
    const settings: BibleCharacterSettings = {
      onlyReviewed: stored.onlyReviewed === true,
      turnHours: (TURN_HOURS_OPTIONS as readonly number[]).includes(
        stored.turnHours as number,
      )
        ? (stored.turnHours as number)
        : DEFAULT_TURN_HOURS,
    };
    this.cacheService.set(key, settings, CACHE_TTL_SECONDS);
    return settings;
  }

  async updateSettings(
    patch: Partial<BibleCharacterSettings>,
    admin: Admin,
  ): Promise<BibleCharacterSettings> {
    const changes = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ) as Partial<BibleCharacterSettings>;
    const next = { ...(await this.settings()), ...changes };
    let row = await this.settingRepo.findOne({ where: { key: SETTINGS_KEY } });
    if (!row) {
      row = this.settingRepo.create({
        key: SETTINGS_KEY,
        moduleName: 'Guess the Bible Character',
        value: { ...next },
      });
    } else {
      row.value = { ...next };
    }
    await this.settingRepo.save(row);
    this.cacheService.del(this.cacheService.key(CACHE_KEY, 'settings'));
    this.auditLogService.log('BIBLE_CHARACTER_SETTINGS_UPDATED', {
      actorId: admin.member?.id,
      metadata: { ...changes },
    });
    return next;
  }

  // The characters the game may pick from in this church.
  async playable(): Promise<PlayableCharacter[]> {
    const [reviews, settings] = await Promise.all([
      this.reviews(),
      this.settings(),
    ]);
    return characterData().list.flatMap((c) => {
      const r = reviews.get(c.id);
      if (r?.hidden) return [];
      if (settings.onlyReviewed && !r?.reviewedAt) return [];
      return [
        {
          ...c,
          summary: r?.summaryOverride ?? c.summary,
          clues: r?.cluesOverride ?? c.clues,
        },
      ];
    });
  }

  // Each clue must be a real verse that names the character, so the game can blank the name out as a hint.
  private parseClues(c: BibleCharacter, inputs: string[]): string[] {
    const terms = matchTerms(c);
    const refs = inputs.map((input) => {
      const ref = parseRef(input);
      const v = ref ? verse(ref) : null;
      if (!ref || !v)
        throw new BadRequestException(
          `"${input}" isn't a verse in the KJV. Write it like Genesis 12:1`,
        );
      if (!mentions(v.text, terms))
        throw new BadRequestException(
          `${label(ref)} doesn't mention ${c.name} by name. Pick a verse that does, so the game can use it as a hint`,
        );
      return ref;
    });
    if (new Set(refs).size !== refs.length)
      throw new BadRequestException('Each clue verse must be different');
    return refs;
  }

  // The whole review table is small (at most one row per character), so it's read at once and cached.
  private async reviews(): Promise<Map<string, ReviewState>> {
    const key = this.cacheService.key(CACHE_KEY, 'reviews');
    let rows = await this.cacheService.get<ReviewState[]>(key);
    if (!rows) {
      const found = await this.reviewRepo.find({
        relations: { reviewedBy: { member: true } },
      });
      rows = found.map((r) => ({
        characterId: r.characterId,
        hidden: r.hidden,
        reviewedAt: r.reviewedAt ? new Date(r.reviewedAt).toISOString() : null,
        reviewedBy: r.reviewedBy?.member
          ? `${r.reviewedBy.member.firstname} ${r.reviewedBy.member.lastname}`
          : null,
        summaryOverride: r.summaryOverride,
        cluesOverride: r.cluesOverride,
      }));
      this.cacheService.set(key, rows, CACHE_TTL_SECONDS);
    }
    return new Map(rows.map((r) => [r.characterId, r]));
  }
}
