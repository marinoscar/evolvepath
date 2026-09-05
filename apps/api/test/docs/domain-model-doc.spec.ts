import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CommitmentStatus,
  Domain,
  DomainModeKind,
  EvidenceSource,
  OutcomeState,
  PlanAuthor,
  PlanVersionStatus,
  RoutineFrequency,
  RoutineTriggerType,
} from '@prisma/client';

// =============================================================================
// docs/specs/domain-model.md against the schema it documents (issue #62)
// =============================================================================
//
// The spec is the written contract E04–E11 build on, which makes a stale one
// worse than none: a later epic reads it, believes it, and ships against a
// model that moved. Nothing but a test keeps prose in step with a schema.
//
// It asserts BOTH directions, and the second is the one that actually fires:
//
//   1. Every enum member and table name the document mentions still exists.
//      (Catches a rename.)
//   2. Every enum member and table the SCHEMA has is mentioned. (Catches an
//      addition — the far more common change, and the one a
//      document-side-only check would miss entirely.)
//
// Read from the GENERATED CLIENT rather than by parsing `schema.prisma`: the
// client is what the application actually sees, so a mismatch between the two
// would already be a different failure.
// =============================================================================

const DOC_PATH = resolve(__dirname, '..', '..', '..', '..', 'docs', 'specs', 'domain-model.md');
const SCHEMA_PATH = resolve(__dirname, '..', '..', 'prisma', 'schema.prisma');

const doc = readFileSync(DOC_PATH, 'utf8');

/** The enums the EvolvePath domain owns. Foundation enums are out of scope. */
const DOMAIN_ENUMS = {
  Domain,
  OutcomeState,
  PlanVersionStatus,
  PlanAuthor,
  RoutineTriggerType,
  RoutineFrequency,
  CommitmentStatus,
  EvidenceSource,
  DomainModeKind,
};

/** The nine tables epic #33 added, by their `@@map` names. */
const DOMAIN_TABLES = [
  'best_self_profiles',
  'outcomes',
  'plans',
  'plan_versions',
  'routines',
  'commitments',
  'evidence_items',
  'reflections',
  'domain_modes',
];

describe('docs/specs/domain-model.md', () => {
  it('exists and is substantial enough to be the contract it claims to be', () => {
    expect(doc.length).toBeGreaterThan(4000);
    expect(doc).toContain('# The EvolvePath domain model');
  });

  describe.each(Object.entries(DOMAIN_ENUMS))('%s', (enumName, enumObject) => {
    // The test NAME carries the actionable part — Jest's `expect` takes no
    // message argument, unlike Vitest's — so a failure reads
    // "Domain > documents the member HEALTH".
    it.each(Object.values(enumObject as Record<string, string>))(
      'documents the member %s',
      (member) => {
        expect(doc).toContain(member);
      },
    );

    it('names the enum itself', () => {
      expect(doc).toContain(enumName);
    });
  });

  it.each(DOMAIN_TABLES)('documents the table %s', (table) => {
    expect(doc).toContain(table);
  });

  // The direction that catches an ADDITION rather than a rename: a tenth table
  // added to the domain block without a line here would otherwise slip past.
  it('mentions every table the schema maps in the EvolvePath block', () => {
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    // Anchored on the SECTION DIVIDER, not on the header text alone: the same
    // words appear as a one-line comment inside `model User`, above the domain
    // relations, and matching that first would slice in the whole schema.
    const blockStart = schema.indexOf(
      '=\n// EvolvePath core domain (epic E02)\n// =',
    );
    expect(blockStart).toBeGreaterThan(0);
    const block = schema.slice(blockStart);
    const mapped = [...block.matchAll(/@@map\("([^"]+)"\)/g)].map((match) => match[1]);

    expect(mapped.sort()).toEqual([...DOMAIN_TABLES].sort());

    const undocumented = mapped.filter((table) => !doc.includes(table));
    // Named in the assertion rather than in a message: this is the one that
    // fires when a tenth table is added without a line in the spec.
    expect(undocumented).toEqual([]);
  });

  it('records the invariants a later epic must not quietly break', () => {
    // Each of these is a rule stated in prose that a reader could otherwise
    // reasonably decide to "simplify".
    expect(doc).toContain('plan_versions_one_active_per_plan');
    expect(doc).toContain('SET NULL');
    expect(doc).toContain('404');
    expect(doc).toContain('never 403');
    expect(doc).toContain('createFromFlow');
  });

  it('carries the full transition matrix, not a summary', () => {
    // Every non-terminal source status must appear with its allowed targets;
    // a matrix that documented only the happy path would be worse than none.
    for (const status of ['PLANNED', 'READY', 'STARTED']) {
      expect(doc).toContain(`\`${status}\``);
    }
    expect(doc).toContain('terminal');
  });
});
