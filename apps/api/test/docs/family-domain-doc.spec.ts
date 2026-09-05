import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { FamilyRelationship } from '@prisma/client';

import {
  BEHAVIOUR_LINT_CODE,
  BEHAVIOUR_LINT_MESSAGE,
  OTHER_PERSON_TARGETS,
  OTHER_PERSON_VERBS,
  OTHER_STATE_WORDS,
  lintBehaviourTitle,
} from '../../src/family/behaviour-lint';
import { BEHAVIOUR_REWRITE_PROMPT_VERSION } from '../../src/family/behaviour-lint.service';
import { SUMMARY_NOTE_PROMPT_VERSION } from '../../src/family/family-summary.service';
import { COUNT_KEYS, UNGROUPED_TITLE } from '../../src/family/family-summary.schema';
import { FAMILY_MEMBER_RESPONSE_KEYS } from '../../src/family/family.schema';
import { MATERIALIZE_HORIZON_DAYS } from '../../src/family/ritual-materializer.service';
import {
  DISPLACEMENT_THRESHOLD,
  renderDisplacementNote,
} from '../../src/family/summary-copy';

// =============================================================================
// docs/specs/family-domain.md against the code it documents (issue #53)
// =============================================================================
//
// The same bargain `today-and-nba.md` and `domain-model.md` have: E10, E11 and
// E12 will read this document, believe it, and ship against it — so a stale one
// is worse than none.
//
// It asserts the DIRECTION THAT ACTUALLY FIRES: every constant the code exports
// appears in the document with its current VALUE. Moving the horizon from 7 days
// to 14 and leaving the table alone is the realistic mistake, and a
// document-mentions-the-name check would sail straight past it.
//
// ONE DELIBERATE OMISSION. The lint's WORD LISTS are not copied into the
// document — it says so, and this spec asserts that it says so. Three lists
// reproduced in prose are three lists to keep in step, and the failure mode of
// getting that wrong is a document that describes a rule the code does not have.
// What the document carries instead is the SHAPE of each rule and the PRD §32
// examples, which do not change when a synonym is added.
// =============================================================================

const DOC_PATH = resolve(
  __dirname, '..', '..', '..', '..', 'docs', 'specs', 'family-domain.md',
);

const doc = readFileSync(DOC_PATH, 'utf8');

/**
 * The document with its line wrapping collapsed.
 *
 * Every "does the document still say this sentence?" assertion runs against
 * this rather than the raw text: prose is hard-wrapped at 80 columns, so a
 * quoted sentence is almost never on one line, and a raw `toContain` would fail
 * for reflowing a paragraph — which teaches the next person to delete the test.
 */
const flat = doc
  // Blockquote markers first: a quoted sentence that wraps becomes
  // "…with\n> project", and collapsing whitespace alone would leave the `>`
  // sitting in the middle of it.
  .replace(/^\s*>\s?/gm, ' ')
  .replace(/\s+/g, ' ');

describe('docs/specs/family-domain.md', () => {
  it('exists and is substantial enough to be the contract it claims to be', () => {
    expect(doc.length).toBeGreaterThan(8000);
    expect(doc).toContain('# The Family domain');
  });

  describe('the privacy boundary', () => {
    it.each([...FAMILY_MEMBER_RESPONSE_KEYS])('names the permitted field %s', (key) => {
      expect(doc).toContain(key);
    });

    it('names both tables and both new commitment columns', () => {
      for (const name of ['family_members', 'rituals', 'ritual_id', 'family_member_id']) {
        expect(doc).toContain(name);
      }
    });

    it('documents every relationship the enum offers', () => {
      for (const value of Object.values(FamilyRelationship)) {
        expect(doc).toContain(value);
      }
    });

    it('states that audit meta carries the relationship and nothing else', () => {
      expect(doc).toContain('family_member:create');
      expect(flat).toMatch(/meta:\s*\{\s*relationship\s*\}/);
    });
  });

  describe('the constants, with their current values', () => {
    it('documents the materialization horizon', () => {
      expect(doc).toContain('MATERIALIZE_HORIZON_DAYS');
      // The VALUE, not just the name — moving it and leaving the table is the
      // mistake this exists to catch.
      expect(doc).toMatch(
        new RegExp(`MATERIALIZE_HORIZON_DAYS\`?\\s*\\|?\\s*\`?${MATERIALIZE_HORIZON_DAYS}\``),
      );
    });

    it('documents the displacement threshold', () => {
      expect(doc).toContain('DISPLACEMENT_THRESHOLD');
      expect(doc).toMatch(
        new RegExp(`DISPLACEMENT_THRESHOLD\`? = ${DISPLACEMENT_THRESHOLD}`),
      );
    });

    it('documents both prompt versions', () => {
      expect(doc).toContain(BEHAVIOUR_REWRITE_PROMPT_VERSION);
      expect(doc).toContain(SUMMARY_NOTE_PROMPT_VERSION);
    });

    it('documents the lint error code and its user-facing sentence', () => {
      expect(doc).toContain(BEHAVIOUR_LINT_CODE);
      expect(doc).toContain(BEHAVIOUR_LINT_MESSAGE);
    });
  });

  describe('the summary contract', () => {
    it('documents every count the payload carries', () => {
      for (const key of COUNT_KEYS) {
        expect(doc).toContain(`\`${key}\``);
      }
    });

    it('names the line ad-hoc commitments are grouped under', () => {
      expect(doc).toContain(UNGROUPED_TITLE);
    });

    // The sentence a user actually reads. Quoted, so a copy edit that changes
    // the code and not the document fails here.
    it('quotes the displacement sentence verbatim', () => {
      const rendered = renderDisplacementNote({ count: 2, eveningCount: 2, weeks: 1 });
      const question = rendered.slice(rendered.indexOf('Do you want'));

      expect(flat).toContain(question);
      expect(flat).toContain('Work displaced {count} {evening}family commitment{s} {period}.');
    });

    it('records the no-score rule and the pattern that enforces it', () => {
      expect(doc).toContain('no-score.guard.spec.ts');
      expect(doc).toContain('(score|quality|rating|grade|sentiment)s?');
      expect(flat).toContain('no leading word boundary');
    });
  });

  describe('the behaviour lint', () => {
    // The document explains the SHAPE of each rule; the words live in one place.
    it('does not copy the word lists', () => {
      const listed = [...OTHER_PERSON_VERBS, ...OTHER_PERSON_TARGETS, ...OTHER_STATE_WORDS];
      const quoted = listed.filter((word) => doc.includes(`\`${word}\``));

      expect(quoted).toEqual([]);
      expect(flat).toContain('this document deliberately does not copy them');
    });

    it('names all three rules and their evaluation order', () => {
      expect(doc).toMatch(/\*\*B\*\*/);
      expect(doc).toMatch(/\*\*A\*\*/);
      expect(doc).toMatch(/\*\*C\*\*/);
      expect(doc).toContain('Evaluated **B, A, C**');
    });

    // The examples ARE the contract, and they are the part a reader checks
    // against. Every one quoted in the document must still get the verdict the
    // document claims.
    it.each([
      ['Make spouse happier.', false],
      ["Improve daughter's attitude.", false],
      ['Mia should read more', false],
      ['get the kids to listen', false],
      ['Put phone away during dinner.', true],
      ['Spend 20 minutes helping child with project.', true],
      ['Plan Saturday outing by Thursday.', true],
      ['Make pancakes with the kids', true],
    ])('still gets %s right, as the document says', (title, expected) => {
      expect(flat).toContain(title.replace(/\.$/, ''));
      expect(lintBehaviourTitle(title).ok).toBe(expected);
    });
  });

  describe('the rules a later epic must not quietly break', () => {
    it.each([
      // Each of these is a rule a reader could otherwise reasonably "simplify".
      '@@unique([ritualId, scheduledStart])',
      'Temporal',
      'through E02-04\'s transition matrix',
      'nothing is ever deleted',
      'not a sixth destination',
      'FAMILY only',
      'always 200',
    ])('records %s', (phrase) => {
      expect(flat.toLowerCase()).toContain(phrase.toLowerCase());
    });

    it('warns against the cancel-everything rebuild the e2e caught', () => {
      expect(flat).toContain('Do not "simplify" this to cancel-everything-then-re-materialize');
      expect(doc).toContain('family.spec.ts');
    });
  });

  describe('the related documents', () => {
    it.each([
      'domain-model.md',
      'today-and-nba.md',
      'ai-gateway.md',
      'settings-ui.md',
    ])('links to %s', (name) => {
      expect(doc).toContain(name);
    });
  });
});
