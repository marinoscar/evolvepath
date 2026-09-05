import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createTestApp, closeTestApp, TestContext } from '../../test/helpers/test-app.helper';
import { createOpenApiDocument } from '../openapi/document';
import {
  familySummarySchema,
  ritualWeekCountsSchema,
  familySummaryWeekSchema,
} from './family-summary.schema';
import { familyMemberResponseSchema, ritualResponseSchema } from './family.schema';

// =============================================================================
// THE NO-SCORE RULE (issue #45, epic E08)
// =============================================================================
//
// VISION §12 forbids any relationship or parenting score outright, and PRD §105
// makes "Product never creates family-quality score" a hard acceptance rule.
// The product measures whether the user behaved in line with their own stated
// intentions — never the quality of a relationship, which is not the app's to
// assess and which the other people involved never consented to have assessed.
//
// A rule that lives only in review comments is a rule that lasts until somebody
// adds a `keptRatio` because a designer asked for a progress bar. So this file
// is the enforcement, in three directions:
//
//   1. The SOURCE of every family schema and DTO.
//   2. The PUBLISHED CONTRACT — every `/api/family` path in the OpenAPI
//      document and every schema it references. This is the one that catches a
//      field added through a DTO class rather than a Zod schema.
//   3. The SCHEMAS THEMSELVES are `.strict()`, so an extra key cannot ride
//      along at runtime even if it were never declared.
//
// This spec is the ONLY place in `src/family` where these words may appear.
// =============================================================================

// No LEADING `\b`, deliberately: the realistic mistake is `keptQuality` or
// `familyScore`, not a bare `score`, and a word-boundary on the left would miss
// every camelCase compound — which is how a field would actually be named.
const FORBIDDEN = /(score|quality|rating|grade|sentiment)s?\b/i;

const FAMILY_DIR = resolve(__dirname);

/**
 * Source text with comments removed.
 *
 * Comments are exempt because explaining the rule requires naming it — the
 * schema file's own header says "no notes, mood or score key rides along", and
 * a check over raw text would fail on the sentence that documents the check.
 * Strings are NOT exempt: a stray `qualityScore` in a Zod `.describe()` reaches
 * the published contract and must fail.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function familySourceFiles(): string[] {
  const found: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);

      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }

      // The schemas and the DTOs are the contract. Services are checked through
      // the document they produce, and specs are exempt by definition — this
      // one has to name the words to test for them.
      if (/\.schema\.ts$/.test(entry) || /[\\/]dto[\\/].*\.ts$/.test(path)) {
        found.push(path);
      }
    }
  };

  walk(FAMILY_DIR);

  return found;
}

describe('the no-score rule — source', () => {
  const files = familySourceFiles();

  it('finds the family schemas and DTOs to check', () => {
    // A guard that silently checks nothing is worse than no guard.
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files.some((path) => path.endsWith('family-summary.schema.ts'))).toBe(true);
    expect(files.some((path) => path.endsWith('family-member.dto.ts'))).toBe(true);
  });

  it.each(files.map((path) => [path.slice(FAMILY_DIR.length + 1), path]))(
    '%s declares no score, quality, rating, grade or sentiment',
    (_label, path) => {
      expect(withoutComments(readFileSync(path, 'utf8'))).not.toMatch(FORBIDDEN);
    },
  );

  // Without this, the whole file could pass because the regex was broken.
  it('would catch a planted field', () => {
    const planted = `export const bad = z.object({ keptQuality: z.number() });`;

    expect(withoutComments(planted)).toMatch(FORBIDDEN);
  });

  it('exempts a comment but not a string', () => {
    expect(withoutComments('// never add a score here\nconst a = 1;')).not.toMatch(FORBIDDEN);
    expect(withoutComments('const a = z.number().describe("quality");')).toMatch(FORBIDDEN);
  });
});

describe('the no-score rule — schemas', () => {
  it.each([
    ['familySummarySchema', familySummarySchema],
    ['ritualWeekCountsSchema', ritualWeekCountsSchema],
    ['familySummaryWeekSchema', familySummaryWeekSchema],
    ['familyMemberResponseSchema', familyMemberResponseSchema],
    ['ritualResponseSchema', ritualResponseSchema],
  ])('%s refuses an extra key at runtime', (_label, schema) => {
    const base: Record<string, unknown> = {
      timezone: 'UTC',
      weeks: [],
      coachNote: null,
      ritualId: null,
      title: 't',
      planned: 0,
      kept: 0,
      partial: 0,
      moved: 0,
      skipped: 0,
      missed: 0,
      open: 0,
      weekStart: '2026-06-01',
      rituals: [],
      totals: { planned: 0, kept: 0, partial: 0, moved: 0, skipped: 0, missed: 0, open: 0 },
      id: '11111111-1111-4111-8111-111111111111',
      nickname: 'Mia',
      relationship: 'CHILD',
      birthday: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
      purpose: null,
      familyMemberId: null,
      recurrence: { weekdays: [1], time: '18:30', everyNWeeks: 1 },
      idealMinutes: 45,
      minimumMinutes: 10,
      fallbackBehavior: null,
      active: true,
      lastMaterializedThrough: null,
      routineId: null,
    };

    expect(schema.safeParse({ ...base, keptQuality: 0.5 }).success).toBe(false);
  });
});

describe('the no-score rule — the published contract', () => {
  let context: TestContext;
  let familyContract: string;

  beforeAll(async () => {
    context = await createTestApp();
    const document = createOpenApiDocument(context.app) as unknown as {
      paths: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    };

    const paths = Object.entries(document.paths).filter(([path]) =>
      path.startsWith('/api/family'),
    );

    expect(paths.length).toBeGreaterThan(0);

    // Every schema the family paths reference, transitively — a `$ref` to a
    // component named elsewhere is exactly how a forbidden field would arrive
    // without appearing in this module at all.
    const schemas = document.components?.schemas ?? {};
    const collected = new Map<string, unknown>();
    const queue = paths.map(([, operations]) => JSON.stringify(operations));

    while (queue.length > 0) {
      const chunk = queue.shift()!;

      for (const [, name] of chunk.matchAll(/#\/components\/schemas\/([A-Za-z0-9_.-]+)/g)) {
        if (collected.has(name) || !(name in schemas)) continue;

        collected.set(name, schemas[name]);
        queue.push(JSON.stringify(schemas[name]));
      }
    }

    familyContract = JSON.stringify([
      Object.fromEntries(paths),
      Object.fromEntries(collected),
    ]);
  }, 60000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('publishes no score, quality, rating, grade or sentiment under /api/family', () => {
    expect(familyContract).not.toMatch(FORBIDDEN);
  });

  it('actually inspected the family paths and their schemas', () => {
    // Guards against the assertion above passing because the slice was empty.
    expect(familyContract).toContain('/api/family/summary');
    expect(familyContract).toContain('planned');
    expect(familyContract).toContain('kept');
  });
});
