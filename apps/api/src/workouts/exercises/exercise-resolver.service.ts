import { Injectable, Logger } from '@nestjs/common';
import type { Equipment, Exercise, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { normalizeExerciseName } from '../programs/workout-program-rules';

// =============================================================================
// Turning the names a model wrote into rows (issue #77, epic E09)
// =============================================================================
//
// The programmer persona emits `exerciseName` strings, never ids (see
// `workout-program.schema.ts`). This is where they become foreign keys, and the
// rule is simple:
//
//   exact catalog/user match → close enough match → create a custom row
//
// IT NEVER FAILS. A movement the catalog has never heard of is a real answer —
// "Sled Push", "Reformer Roll-Down" — and refusing the whole program over one
// unfamiliar name would throw away nine good workouts. The unknown one becomes
// a custom row scoped to the user, carrying `substitutionGroup: 'custom'` and no
// contraindication tags, which is exactly what "we do not know anything about
// this movement" should look like downstream.
//
// The near-match threshold is DICE COEFFICIENT ON BIGRAMS at 0.85, chosen
// because it forgives word order and small spelling differences ("Romanian
// Deadlift, Dumbbell") while rejecting the substitutions that matter: "Dumbbell
// Bench Press" and "Dumbbell Shoulder Press" score well under it, and silently
// mapping one to the other would put a different exercise in the user's program
// than the coach prescribed.
// =============================================================================

/** Names at or above this similarity are the same movement. */
export const NEAR_MATCH_THRESHOLD = 0.85;

function bigrams(value: string): string[] {
  const pairs: string[] = [];

  for (let i = 0; i < value.length - 1; i += 1) pairs.push(value.slice(i, i + 2));

  return pairs;
}

/** Sørensen–Dice over character bigrams. 1 is identical, 0 shares nothing. */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const left = bigrams(a);
  const right = new Map<string, number>();

  for (const pair of bigrams(b)) right.set(pair, (right.get(pair) ?? 0) + 1);

  let hits = 0;

  for (const pair of left) {
    const remaining = right.get(pair) ?? 0;

    if (remaining > 0) {
      right.set(pair, remaining - 1);
      hits += 1;
    }
  }

  return (2 * hits) / (left.length + bigrams(b).length);
}

export interface ResolveOptions {
  /** Equipment stamped on any custom row this creates. */
  equipment: Equipment[];
}

@Injectable()
export class ExerciseResolverService {
  private readonly logger = new Logger(ExerciseResolverService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Catalog rows plus this user's own, which is what every read here means. */
  visibleWhere(userId: string): Prisma.ExerciseWhereInput {
    return { OR: [{ scope: 'catalog' }, { scope: userId }] };
  }

  async list(
    userId: string,
    query: { q?: string; group?: string } = {},
  ): Promise<Exercise[]> {
    const where: Prisma.ExerciseWhereInput = { ...this.visibleWhere(userId) };

    if (query.group) where.substitutionGroup = query.group;
    if (query.q) where.name = { contains: query.q, mode: 'insensitive' };

    return this.prisma.exercise.findMany({ where, orderBy: [{ name: 'asc' }] });
  }

  /**
   * Resolve every name to a row, creating custom rows for the leftovers.
   *
   * @returns a map keyed by the NORMALIZED name, so a caller that wrote
   *   "  goblet   SQUAT " and one that wrote "Goblet Squat" land on one entry.
   */
  async resolveMany(
    names: string[],
    userId: string,
    options: ResolveOptions,
  ): Promise<Map<string, Exercise>> {
    const wanted = [...new Set(names.map(normalizeExerciseName))].filter(Boolean);
    const resolved = new Map<string, Exercise>();

    if (wanted.length === 0) return resolved;

    const visible = await this.prisma.exercise.findMany({ where: this.visibleWhere(userId) });
    const byKey = new Map(visible.map((row) => [row.nameKey, row] as const));

    const unresolved: string[] = [];

    for (const key of wanted) {
      const exact = byKey.get(key);

      if (exact) {
        resolved.set(key, exact);
        continue;
      }

      let best: { row: Exercise; score: number } | null = null;

      for (const row of visible) {
        const score = diceCoefficient(key, row.nameKey);

        if (!best || score > best.score) best = { row, score };
      }

      if (best && best.score >= NEAR_MATCH_THRESHOLD) {
        resolved.set(key, best.row);
        continue;
      }

      unresolved.push(key);
    }

    for (const key of unresolved) {
      // The original spelling, not the normalized key: the user reads this name.
      const original = names.find((name) => normalizeExerciseName(name) === key) ?? key;

      // Upsert rather than create: two concurrent generations for the same user
      // naming the same unknown movement would otherwise race to a P2002.
      const created = await this.prisma.exercise.upsert({
        where: { scope_nameKey: { scope: userId, nameKey: key } },
        update: {},
        create: {
          name: original.trim(),
          nameKey: key,
          scope: userId,
          isCustom: true,
          createdByUserId: userId,
          equipment: options.equipment,
          movementPattern: 'ACCESSORY',
          instructions: '',
          contraindicationTags: [],
          substitutionGroup: 'custom',
        },
      });

      resolved.set(key, created);
    }

    if (unresolved.length > 0) {
      this.logger.log(
        `exercise.resolve created ${unresolved.length} custom movement(s) user=${userId}`,
      );
    }

    return resolved;
  }
}
