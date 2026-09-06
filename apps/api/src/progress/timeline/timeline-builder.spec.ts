import {
  afterCursor,
  buildTimeline,
  decodeCursor,
  encodeCursor,
  type TimelineEvidenceRow,
  type TimelineRows,
} from './timeline-builder';

// =============================================================================
// The evidence timeline (issue #115, epic E11)
// =============================================================================
//
// PRD §76 gives four example lines. They are reproduced here from fixtures,
// because "meaningful" is a product decision and the way it fails is silently:
// a rule added for pause evidence would turn the story back into a log and no
// existing assertion would notice.
// =============================================================================

const DAY = 86_400_000;
const T0 = new Date('2026-03-01T09:00:00.000Z');

function evidence(over: Partial<TimelineEvidenceRow> = {}): TimelineEvidenceRow {
  return {
    id: 'e1',
    evidenceType: 'completed',
    occurredAt: T0,
    commitmentId: 'c1',
    commitment: {
      title: 'Upper A',
      domain: 'HEALTH',
      rescheduleCount: 0,
      versionUsed: null,
      commitmentType: 'workout',
    },
    ...over,
  };
}

function rows(over: Partial<TimelineRows> = {}): TimelineRows {
  return { evidence: [], misses: [], planChanges: [], milestones: [], ...over };
}

const titles = (events: ReturnType<typeof buildTimeline>) =>
  events.map((event) => event.title);

describe('buildTimeline (#115)', () => {
  describe('the four PRD §76 examples', () => {
    it('“Started avoided proposal after two postponements”', () => {
      const events = buildTimeline(
        rows({
          evidence: [
            evidence({
              evidenceType: 'started',
              commitment: {
                title: 'the proposal',
                domain: 'WORK',
                rescheduleCount: 2,
                versionUsed: null,
                commitmentType: null,
              },
            }),
          ],
        }),
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: 'started_after_postpone',
        significance: 'notable',
        title: 'Started the proposal after 2 postponements',
      });
    });

    it('“Completed Upper A”', () => {
      const events = buildTimeline(rows({ evidence: [evidence()] }));

      expect(events[0]).toMatchObject({
        kind: 'completed',
        significance: 'ordinary',
        title: 'Completed Upper A',
      });
    });

    it('“Protected family dinner”', () => {
      const events = buildTimeline(
        rows({
          evidence: [
            evidence({
              commitment: {
                title: 'family dinner',
                domain: 'FAMILY',
                rescheduleCount: 0,
                versionUsed: null,
                commitmentType: null,
              },
            }),
          ],
        }),
      );

      // Protected, never "completed": VISION §12 is clear that the family
      // domain is not a scoreboard.
      expect(events[0]).toMatchObject({
        kind: 'family_kept',
        significance: 'notable',
        title: 'Protected family dinner',
      });
    });

    it('“Returned to Health plan after one missed workout”', () => {
      const events = buildTimeline(
        rows({
          evidence: [evidence({ occurredAt: new Date(T0.getTime() + 3 * DAY) })],
          misses: [
            { id: 'm1', domain: 'HEALTH', scheduledStart: new Date(T0.getTime() + DAY) },
          ],
        }),
      );

      expect(titles(events)).toContain('Returned to Health plan after 1 missed');
      expect(events.find((e) => e.kind === 'returned_after_miss')?.significance).toBe(
        'notable',
      );
    });
  });

  describe('what is deliberately not an event', () => {
    it.each([['paused'], ['continued'], ['rescheduled'], ['fallback_selected']])(
      'ignores %s evidence — a log is not a story',
      (evidenceType) => {
        expect(buildTimeline(rows({ evidence: [evidence({ evidenceType })] }))).toEqual([]);
      },
    );

    it('ignores an ordinary start — only a postponed one is remarkable', () => {
      expect(
        buildTimeline(rows({ evidence: [evidence({ evidenceType: 'started' })] })),
      ).toEqual([]);
    });

    it('does not claim a return when there was nothing to return from', () => {
      const events = buildTimeline(rows({ evidence: [evidence()] }));

      expect(events.map((e) => e.kind)).not.toContain('returned_after_miss');
    });
  });

  describe('the labels that carry meaning', () => {
    it('labels a fallback completion without diminishing it', () => {
      const events = buildTimeline(
        rows({
          evidence: [
            evidence({
              commitment: {
                title: 'Upper A',
                domain: 'HEALTH',
                rescheduleCount: 0,
                versionUsed: 'MINIMUM',
                commitmentType: 'workout',
              },
            }),
          ],
        }),
      );

      expect(events[0]).toMatchObject({
        kind: 'completed_fallback',
        title: 'Completed Upper A — minimum version',
      });
    });

    it('names partial progress as progress', () => {
      const events = buildTimeline(
        rows({ evidence: [evidence({ evidenceType: 'partially_completed' })] }),
      );

      expect(events[0]).toMatchObject({
        kind: 'partially_completed',
        title: 'Made progress on Upper A',
      });
    });

    it('renders a recovery row as "Back on Path"', () => {
      const events = buildTimeline(
        rows({ evidence: [evidence({ evidenceType: 'recovery' })] }),
      );

      expect(events[0]).toMatchObject({
        kind: 'comeback_completed',
        significance: 'notable',
        title: 'Back on Path',
      });
    });

    it('carries the plan’s own rationale, trimmed to one line', () => {
      const events = buildTimeline(
        rows({
          planChanges: [
            {
              id: 'a1',
              at: T0,
              toVersion: 3,
              rationale: 'Mornings stopped working\nso we moved everything to evenings',
            },
          ],
        }),
      );

      expect(events[0]).toMatchObject({
        kind: 'plan_change_accepted',
        title: 'Plan updated to v3',
        detail: 'Mornings stopped working',
      });
    });

    it('renders a milestone at milestone significance', () => {
      const events = buildTimeline(
        rows({
          milestones: [
            {
              id: '9c1',
              kind: 'FIRST_COMEBACK',
              sequence: 1,
              domain: null,
              achievedAt: T0.toISOString(),
              acknowledgedAt: null,
              title: 'First comeback',
              body: 'You returned.',
              meta: {},
            },
          ],
        }),
      );

      expect(events[0]).toMatchObject({
        kind: 'milestone',
        significance: 'milestone',
        milestoneId: '9c1',
      });
    });
  });

  describe('ordering and pagination', () => {
    const many = rows({
      evidence: Array.from({ length: 5 }, (_, i) =>
        evidence({ id: `e${i}`, occurredAt: new Date(T0.getTime() + i * DAY) }),
      ),
    });

    it('is newest first and byte-identical across runs', () => {
      const first = buildTimeline(many);
      const second = buildTimeline(many);

      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.map((e) => e.id)).toEqual(['e4', 'e3', 'e2', 'e1', 'e0']);
    });

    it('pages with no duplicates and no gaps', () => {
      const all = buildTimeline(many);
      const pageOne = all.slice(0, 2);
      const pageTwo = afterCursor(all, decodeCursor(encodeCursor(pageOne[1]))!).slice(0, 2);

      expect(pageOne.map((e) => e.id)).toEqual(['e4', 'e3']);
      expect(pageTwo.map((e) => e.id)).toEqual(['e2', 'e1']);
    });

    it('breaks a timestamp tie by id, so a cursor can never loop', () => {
      const tied = rows({
        evidence: [evidence({ id: 'b' }), evidence({ id: 'a' })],
      });

      expect(buildTimeline(tied).map((e) => e.id)).toEqual(['a', 'b']);
    });

    it('survives a malformed cursor rather than trusting it', () => {
      expect(decodeCursor('not-base64-at-all!!')).toBeNull();
    });
  });
});
