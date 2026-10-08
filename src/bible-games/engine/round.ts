import { Question, makeQuestion, verseQuestion } from './questions';
import { LevelSpec } from './levels';
import { Rng, weighted, shuffle } from './rng';

const ATTEMPTS_PER_QUESTION = 40;
// Keeps a round varied: no single question type takes more than 4 of 10.
const MAX_SHARE_PER_KIND = 0.4;

export interface RoundOptions {
  // Keys seen recently by this member.
  avoid?: ReadonlySet<string>;
  // Questions an admin hid.
  exclude?: (q: Question) => boolean;
  // Church-written questions to mix in (up to MAX_CUSTOM per round).
  extras?: Question[];
}

const MAX_CUSTOM = 2;

// A round of questions for a level: a couple of church-written ones (if any), the rest generated, skipping hidden
// questions, keys the member has seen recently and repeats within the round.
export function buildRound(
  rng: Rng,
  spec: LevelSpec,
  count: number,
  opts: RoundOptions = {},
): Question[] {
  const avoid = opts.avoid ?? new Set<string>();
  const exclude = opts.exclude ?? (() => false);
  const used = new Set<string>();
  const perKind = new Map<string, number>();
  const maxPerKind =
    spec.kinds.length > 1 ? Math.ceil(count * MAX_SHARE_PER_KIND) : count;
  const out: Question[] = [];

  const fresh = (opts.extras ?? []).filter((q) => !avoid.has(q.key));
  for (const q of shuffle(
    rng,
    fresh.length ? fresh : (opts.extras ?? []),
  ).slice(0, MAX_CUSTOM)) {
    used.add(q.key);
    out.push(q);
  }

  while (out.length < count) {
    let q: Question | null = null;
    for (let tries = 0; tries < ATTEMPTS_PER_QUESTION; tries++) {
      const candidate = makeQuestion(rng, weighted(rng, spec.kinds));
      if (!candidate || used.has(candidate.key) || exclude(candidate)) continue;
      if (
        (perKind.get(candidate.kind) ?? 0) >= maxPerKind &&
        tries < ATTEMPTS_PER_QUESTION - 5
      )
        continue;
      // Fall back to a recently seen question only when the pool is nearly exhausted.
      if (avoid.has(candidate.key) && tries < ATTEMPTS_PER_QUESTION - 5)
        continue;
      q = candidate;
      break;
    }
    if (!q) break;
    used.add(q.key);
    perKind.set(q.kind, (perKind.get(q.kind) ?? 0) + 1);
    out.push(q);
  }
  return shuffle(rng, out);
}

// "This week's verses": one question per verse the church noted most, in a shuffled order.
export function buildVerseRound(
  rng: Rng,
  refs: string[],
  count: number,
  exclude: (q: Question) => boolean = () => false,
): Question[] {
  const out: Question[] = [];
  for (const ref of shuffle(rng, refs)) {
    const q = verseQuestion(rng, ref);
    if (q && !exclude(q)) out.push(q);
    if (out.length === count) break;
  }
  return out;
}
