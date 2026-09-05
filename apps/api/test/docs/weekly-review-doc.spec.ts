import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { WEEKLY_REVIEWER_PROMPT_VERSION } from '../../src/weekly/prompts/weekly-reviewer.prompt';
import { WEEKLY_REVIEW_SCHEMA_NAME } from '../../src/weekly/contracts/weekly-review.contract';
import { DEFAULT_TIME } from '../../src/weekly/materialize-week';
import {
  domainCountsSchema,
  weeklyReviewOutputSchema,
} from '../../src/weekly/weekly.schema';
import configuration from '../../src/config/configuration';

// =============================================================================
// docs/specs/weekly-review.md against the code it documents (issue #89)
// =============================================================================
//
// The same bargain `family-domain.md` and `today-and-nba.md` have: E11 reads
// this document for the aggregation it reuses and E12 for the N8 hand-off, so a
// stale one is worse than none.
//
// It asserts the DIRECTION THAT ACTUALLY FIRES: every constant the code exports
// appears in the document WITH ITS CURRENT VALUE. Moving the soft cap from 8 to
// 12 and leaving the table alone is the realistic mistake, and a
// document-mentions-the-name check would sail straight past it.
// =============================================================================

const DOC_PATH = resolve(
  __dirname, '..', '..', '..', '..', 'docs', 'specs', 'weekly-review.md',
);

const doc = readFileSync(DOC_PATH, 'utf8');

/** The document with its line wrapping collapsed — see the family doc spec. */
const flat = doc.replace(/^\s*>\s?/gm, ' ').replace(/\s+/g, ' ');

describe('docs/specs/weekly-review.md', () => {
  it('exists and is substantial enough to be the contract it claims to be', () => {
    expect(doc.length).toBeGreaterThan(8000);
    expect(doc).toContain('# The weekly loop');
  });

  describe('the aggregation rules', () => {
    it('defines every count the schema carries', () => {
      // A field the document forgets is a field E11 will read and mean
      // something else by.
      for (const key of Object.keys(domainCountsSchema.shape)) {
        expect(doc).toContain(key);
      }
    });

    it('states the partial weight actually used', () => {
      expect(flat).toContain('(completed + 0.5 × partial) / planned');
    });

    it('states the time-window boundaries with their hours', () => {
      for (const boundary of [
        'early_morning',
        '< 07',
        'morning',
        '07–11',
        'midday',
        '12–13',
        'afternoon',
        '14–17',
        'evening',
        '18–21',
        'night',
        '≥ 22',
      ]) {
        expect(flat).toContain(boundary);
      }
    });

    it('records the three rules that are easy to get wrong', () => {
      expect(flat).toContain('A rescheduled intention is counted once');
      expect(flat).toContain('A row still in the future is not a miss');
      expect(flat).toContain('`unresolved` is not `missed`');
    });
  });

  describe('the reviewer contract', () => {
    it('names the persona, its prompt version and its schema name', () => {
      expect(doc).toContain('weekly_reviewer');
      expect(doc).toContain(WEEKLY_REVIEWER_PROMPT_VERSION);
      expect(doc).toContain(WEEKLY_REVIEW_SCHEMA_NAME);
    });

    it('lists all six outputs by their field names', () => {
      for (const key of Object.keys(weeklyReviewOutputSchema.shape)) {
        expect(doc).toContain(key);
      }
    });

    it('states that no code path here writes a plan version', () => {
      expect(flat).toContain('No code path in this epic writes a `PlanVersion`');
    });
  });

  describe('materialisation and the load check', () => {
    it('states each domain default time with its value', () => {
      // `WORK 09:00, FAMILY 18:30, HEALTH 07:00` — the values, not the names.
      for (const [domain, time] of Object.entries(DEFAULT_TIME)) {
        expect(flat).toMatch(new RegExp(`${domain}[^)]{0,3}${time}`));
      }
    });

    it('states the soft cap default that configuration.ts actually applies', () => {
      const configured = (configuration() as { weekly: { loadSoftCap: number } }).weekly
        .loadSoftCap;

      // The value, not the name: moving the cap and leaving the table alone is
      // the realistic mistake, and a name check sails straight past it.
      expect(flat).toContain(`WEEKLY_LOAD_SOFT_CAP\` (default ${configured})`);
    });

    it('states the weekday multiplier the capacity warning uses', () => {
      expect(flat).toContain('5 × weekdayMinutes');
    });

    it('names all three exclusion reasons and all three warning codes', () => {
      for (const value of [
        'travel_day',
        'fixed_event',
        'paused_domain',
        'RECURRING_OVER_CAP',
        'MINUTES_OVER_CAPACITY',
        'DAY_OVER_CAPACITY',
      ]) {
        expect(doc).toContain(value);
      }
    });

    it('records that warnings never block', () => {
      expect(flat).toContain('Warnings are data, never exceptions');
      expect(doc).toContain('LOAD_WARNINGS_UNACKNOWLEDGED');
    });
  });

  describe('the parts other epics will read', () => {
    it('names every audit action this epic writes', () => {
      for (const action of [
        'weekly_review:generate',
        'weekly_review:skip',
        'weekly_settings:update',
        'weekly_plan:create',
        'weekly_plan:update',
        'weekly_plan:propose',
        'weekly_plan:approve',
      ]) {
        expect(doc).toContain(action);
      }
    });

    it('explains that N8 is raised by the scanner rather than by generation', () => {
      expect(doc).toContain('coach.weekly_review_ready');
      expect(flat).toContain('not by generation');
    });

    it('keeps its rejected alternatives, which is what stops them coming back', () => {
      expect(doc).toContain('## Rejected alternatives');
      expect(flat).toContain('`@db.Date` for `weekStart`');
      expect(flat).toContain('Blocking approve on a load warning');
    });
  });
});
