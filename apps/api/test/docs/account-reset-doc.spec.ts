import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ACCOUNT_RESET_PHRASES,
  ACCOUNT_RESET_TABLES,
  CUSTOM_EXERCISES_TABLE,
  MEDIA_ATTACHMENTS_TABLE,
  STORAGE_OBJECTS_TABLE,
} from '../../src/account/account-reset.constants';
import { NOTIFICATION_EVENTS } from '../../src/notifications/notification-events';

// =============================================================================
// docs/specs/account-reset.md against the code it documents (epic #220, #225)
// =============================================================================
//
// The reset's delete ORDER encodes an argument that is invisible in the code
// that executes it — a `for` loop over a constant looks the same whichever way
// the constant is sorted. A contributor adding a table, or tidying the list
// alphabetically, would defeat §4's two guarantees with no failing test and no
// visible symptom until somebody inspected a database.
//
// So this suite asserts BOTH directions, and the code -> doc direction is the
// one that actually fires, exactly as `domain-model-doc.spec.ts` argues for its
// own enums: a doc-side-only check catches a document that mentions something
// gone, which is the rarer and less damaging drift.
//
// It also asserts the ORDER, not just membership — which is the part specific
// to this document. Every other doc-spec here protects a value; this one
// protects a sequence.
// =============================================================================

const DOC_PATH = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'docs',
  'specs',
  'account-reset.md',
);
const doc = readFileSync(DOC_PATH, 'utf8');

/**
 * Just the numbered list in section 3, which is the only place the document
 * claims to state the delete ORDER.
 *
 * Scoped deliberately rather than searching the whole file: section 1 names a
 * dozen of these tables in prose while describing the problem, and section 4
 * names several again while arguing about pairs, so a first-mention search over
 * the whole document measures where a table is first DISCUSSED, not where it is
 * listed. That is not the claim being tested.
 */
function sectionThree(): string {
  const start = doc.indexOf('## 3. The table list');
  const end = doc.indexOf('## 4. The delete order');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return doc.slice(start, end);
}

/** Every key the summary and the result carry, in the order they are deleted. */
const ORDERED_TABLES = ACCOUNT_RESET_TABLES.map((entry) => entry.table);

/**
 * Tables named in §5 as deliberately RETAINED. Restated here rather than
 * imported, because there is nothing to import: a retention decision is an
 * ABSENCE from `ACCOUNT_RESET_TABLES`, and an absence cannot be asserted against
 * itself. This list is the assertion — if somebody adds one of these to the
 * delete list, the "is not deleted" test below fails and points at the section
 * of the document that argues for keeping it.
 */
const RETAINED_TABLES = [
  'users',
  'user_identities',
  'user_roles',
  'refresh_tokens',
  'push_subscriptions',
  'audit_events',
  'ai_invocations',
  'notification_deliveries',
  'allowed_emails',
];

/** Tables §3 says cascade, and therefore deliberately have no entry. */
const CASCADING_TABLES = [
  'coach_messages',
  'workout_templates',
  'workout_template_exercises',
  'set_logs',
  'storage_object_chunks',
];

describe('docs/specs/account-reset.md exists and is not a stub', () => {
  it('is a substantial document', () => {
    expect(doc.length).toBeGreaterThan(8_000);
  });

  it('carries the title and the epic provenance line', () => {
    expect(doc).toContain('# Account Data Reset');
    expect(doc).toContain('Epic E13');
  });
});

describe('the two scopes and their phrases are documented verbatim', () => {
  it.each(Object.entries(ACCOUNT_RESET_PHRASES))(
    'documents scope %s and its exact phrase',
    (scope, phrase) => {
      expect(doc).toContain(scope);
      // The phrase itself, character for character. A document that paraphrased
      // it would be describing a gate that does not exist.
      expect(doc).toContain(phrase);
    },
  );

  it('documents exactly two scopes, so a third cannot ship undocumented', () => {
    expect(Object.keys(ACCOUNT_RESET_PHRASES)).toHaveLength(2);
  });
});

describe('every table the reset deletes is documented — code -> doc', () => {
  it.each(ORDERED_TABLES)('documents the table %s', (table) => {
    expect(doc).toContain(table);
  });

  it.each(ACCOUNT_RESET_TABLES)(
    'documents the Prisma accessor for $table',
    ({ model }) => {
      expect(doc).toContain(model);
    },
  );

  it.each([CUSTOM_EXERCISES_TABLE, STORAGE_OBJECTS_TABLE, MEDIA_ATTACHMENTS_TABLE])(
    'documents the out-of-loop key %s',
    (table) => {
      expect(doc).toContain(table);
    },
  );
});

describe('the DELETE ORDER is documented, in order', () => {
  // The assertion this whole file exists for. Membership alone would pass
  // against a list somebody sorted alphabetically for tidiness — which is
  // exactly the change §4 says fails silently.
  it('lists the tables in the same relative order the service deletes them', () => {
    const listed = sectionThree();
    const positions = ORDERED_TABLES.map((table) => ({
      table,
      at: listed.indexOf(`\`${table}\``),
    }));

    for (const { table, at } of positions) {
      expect({ table, at }).toEqual({ table, at: expect.any(Number) });
      expect(at).toBeGreaterThanOrEqual(0);
    }

    const documentedOrder = [...positions]
      .sort((a, b) => a.at - b.at)
      .map((p) => p.table);

    expect(documentedOrder).toEqual(ORDERED_TABLES);
  });

  it('documents that evidence and reflections precede commitments (§4.1)', () => {
    const evidence = ORDERED_TABLES.indexOf('evidence_items');
    const reflections = ORDERED_TABLES.indexOf('reflections');
    const commitments = ORDERED_TABLES.indexOf('commitments');

    expect(evidence).toBeLessThan(commitments);
    expect(reflections).toBeLessThan(commitments);
    expect(doc).toContain('SetNull');
  });

  it('documents that custom exercises follow programs and sessions (§4.2)', () => {
    const programs = ORDERED_TABLES.indexOf('workout_programs');
    const sessions = ORDERED_TABLES.indexOf('workout_sessions');

    expect(programs).toBeGreaterThanOrEqual(0);
    expect(sessions).toBeGreaterThanOrEqual(0);
    // `exercises` is not in the ordered list at all — that is the point, and the
    // document has to say why rather than leaving it looking forgotten.
    expect(ORDERED_TABLES).not.toContain(CUSTOM_EXERCISES_TABLE);
    expect(doc).toContain('Restrict');
    expect(doc).toContain('createdByUserId');
  });

  it('documents that user_profiles and user_settings are last (§4.3)', () => {
    expect(ORDERED_TABLES[ORDERED_TABLES.length - 2]).toBe('user_profiles');
    expect(ORDERED_TABLES[ORDERED_TABLES.length - 1]).toBe('user_settings');
  });
});

describe('the retention boundary is documented and still true', () => {
  it.each(RETAINED_TABLES)('does not delete %s', (table) => {
    expect(ORDERED_TABLES).not.toContain(table);
  });

  it.each(RETAINED_TABLES)('documents why %s is retained', (table) => {
    expect(doc).toContain(table);
  });

  it.each(CASCADING_TABLES)(
    'documents %s as cascading rather than deleted',
    (table) => {
      expect(ORDERED_TABLES).not.toContain(table);
      expect(doc).toContain(table);
    },
  );

  it('still deletes the credentials a user minted', () => {
    expect(ORDERED_TABLES).toContain('personal_access_tokens');
    expect(ORDERED_TABLES).toContain('device_codes');
  });
});

describe('the notification is documented as the registry declares it', () => {
  const event = NOTIFICATION_EVENTS.find((e) => e.key === 'account.data_reset');

  it('is registered', () => {
    expect(event).toBeDefined();
  });

  it('is email-only, default-on and mandatory, and the doc says so', () => {
    expect(event?.channels).toEqual(['email']);
    expect(event?.defaultEnabled).toBe(true);
    expect(event?.mandatory).toBe(true);

    expect(doc).toContain('account.data_reset');
    expect(doc).toContain('mandatory: true');
    expect(doc).toContain("channels: ['email']");
  });
});

describe('the invariants this feature is defined by are stated literally', () => {
  it.each([
    // §0 — the promise every other decision depends on.
    'data reset, not an account deletion',
    // §6 — the reuse that keeps blobs from being orphaned.
    'ObjectsService.delete',
    // §7 — the credential no cascade reaches.
    'deleteForUser',
    // §8 — the ordering that keeps the audit trail honest.
    'audit_events',
    // §9 — the control, as opposed to the convenience.
    'case-sensitively',
    // §12 — the security boundary.
    'no permissions',
  ])('states %p', (phrase) => {
    expect(doc).toContain(phrase);
  });

  it('keeps its rejected-alternatives section', () => {
    expect(doc).toContain('Rejected alternatives');
  });
});
