import { localDate } from '../today/local-date';
import { onboardingProposalSchema, type ProposalDomain } from './onboarding-proposal.schema';
import { buildTemplateProposal, reduceTemplate } from './onboarding-templates';
import { validateOnboardingProposal, type GuardrailContext } from './onboarding.guardrails';

// =============================================================================
// The Path with no model in it (issue #101, epic E04)
// =============================================================================
//
// Every case ends the same way: the output passes the SCHEMA and the
// GUARDRAILS. That pairing is the whole promise of PRD §120's fallback — with
// the provider down, `approve` has to accept what this produced, and a template
// that could not be approved is an outage with extra steps.
//
// And it is asserted across zones, because "the next seven days" is the one
// thing in this file a UTC-only test cannot see going wrong.
// =============================================================================

// A Monday, 08:00 UTC.
const MONDAY = new Date('2026-09-07T08:00:00.000Z');

const SUBSETS: ProposalDomain[][] = [
  ['WORK'],
  ['FAMILY'],
  ['HEALTH'],
  ['WORK', 'FAMILY'],
  ['WORK', 'HEALTH'],
  ['FAMILY', 'HEALTH'],
  ['WORK', 'FAMILY', 'HEALTH'],
];

const ZONES = ['UTC', 'America/Costa_Rica', 'Asia/Tokyo', 'Australia/Adelaide'];

function ctxFor(domains: ProposalDomain[], timezone: string, minutes: number | null): GuardrailContext {
  return { now: MONDAY, timezone, domains, weekdayMinutes: minutes };
}

function assertUsable(proposal: unknown, ctx: GuardrailContext) {
  const parsed = onboardingProposalSchema.safeParse(proposal);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;

  expect(validateOnboardingProposal(parsed.data, ctx)).toEqual([]);
}

describe('buildTemplateProposal', () => {
  it.each(SUBSETS)('gives one outcome and one routine per selected domain (%s)', (...domains) => {
    const selected = domains as ProposalDomain[];

    const proposal = buildTemplateProposal(
      { sixMonthVision: 'Be someone I recognise', domains: selected, weekdayMinutes: 45, healthBaseline: null },
      MONDAY,
      'UTC',
    );

    expect(proposal.outcomes.map((o) => o.domain).sort()).toEqual([...selected].sort());
    expect(proposal.routines.map((r) => r.domain).sort()).toEqual([...selected].sort());
    assertUsable(proposal, ctxFor(selected, 'UTC', 45));
  });

  it.each(ZONES)('schedules every commitment inside the first week in %s', (timezone) => {
    const domains: ProposalDomain[] = ['WORK', 'FAMILY', 'HEALTH'];

    const proposal = buildTemplateProposal(
      { sixMonthVision: 'Be someone I recognise', domains, weekdayMinutes: 60, healthBaseline: null },
      MONDAY,
      timezone,
    );

    const today = localDate(MONDAY, timezone);

    for (const commitment of proposal.firstWeekCommitments) {
      const day = localDate(new Date(commitment.scheduledStart), timezone);

      expect(day >= today).toBe(true);
      expect(day <= addDays(today, 7)).toBe(true);
    }

    assertUsable(proposal, ctxFor(domains, timezone, 60));
  });

  it('never proposes a session longer than the minutes the user said they have', () => {
    const proposal = buildTemplateProposal(
      {
        sixMonthVision: 'Train again',
        domains: ['HEALTH'],
        weekdayMinutes: 15,
        healthBaseline: {
          experience: 'BEGINNER',
          daysPerWeek: 5,
          minutesPerSession: 60,
          equipment: ['Dumbbells'],
        },
      },
      MONDAY,
      'UTC',
    );

    expect(proposal.routines[0].idealMinutes).toBe(15);
    assertUsable(proposal, ctxFor(['HEALTH'], 'UTC', 15));
  });

  it('caps the health baseline at three sessions however many the user asked for', () => {
    const proposal = buildTemplateProposal(
      {
        sixMonthVision: 'Train again',
        domains: ['HEALTH'],
        weekdayMinutes: 60,
        healthBaseline: {
          experience: 'ADVANCED',
          daysPerWeek: 7,
          minutesPerSession: 45,
          equipment: [],
        },
      },
      MONDAY,
      'UTC',
    );

    expect(proposal.firstWeekCommitments.length).toBeLessThanOrEqual(3);
  });

  it('echoes the six-month vision rather than inventing one', () => {
    const proposal = buildTemplateProposal(
      { sixMonthVision: 'I want my mornings back', domains: ['WORK'], weekdayMinutes: null, healthBaseline: null },
      MONDAY,
      'UTC',
    );

    expect(proposal.bestSelf.sixMonthVision).toBe('I want my mornings back');
    expect(proposal.bestSelf.familyIdentity).toBeNull();
    expect(proposal.reducedFromRequest).toBe(false);
  });
});

describe('reduceTemplate', () => {
  const full = () =>
    buildTemplateProposal(
      {
        sixMonthVision: 'Be someone I recognise',
        domains: ['WORK', 'FAMILY', 'HEALTH'],
        weekdayMinutes: 60,
        healthBaseline: null,
      },
      MONDAY,
      'UTC',
    );

  it('asks for fewer weekly minutes than the plan it reduced', () => {
    const before = totalMinutes(full());
    const after = totalMinutes(reduceTemplate(full()));

    expect(after).toBeLessThan(before);
  });

  it('drops one behaviour and keeps at least one commitment', () => {
    const reduced = reduceTemplate(full());

    expect(reduced.routines).toHaveLength(2);
    expect(reduced.firstWeekCommitments.length).toBeGreaterThan(0);
    expect(reduced.reducedFromRequest).toBe(true);
  });

  it('keeps the outcomes — what shrank is the week, not what matters', () => {
    expect(reduceTemplate(full()).outcomes).toHaveLength(3);
  });

  it('never drops the last behaviour', () => {
    const single = buildTemplateProposal(
      { sixMonthVision: 'Train again', domains: ['HEALTH'], weekdayMinutes: 60, healthBaseline: null },
      MONDAY,
      'UTC',
    );

    expect(reduceTemplate(single).routines).toHaveLength(1);
  });

  it('is still approvable', () => {
    assertUsable(reduceTemplate(full()), ctxFor(['WORK', 'FAMILY', 'HEALTH'], 'UTC', 60));
  });
});

function totalMinutes(proposal: ReturnType<typeof buildTemplateProposal>): number {
  return proposal.firstWeekCommitments.reduce((sum, c) => sum + c.durationMinutes, 0);
}

/** Local `YYYY-MM-DD` arithmetic, kept here so the spec adds no dependency. */
function addDays(dateLocal: string, n: number): string {
  const [y, m, d] = dateLocal.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + n));

  return at.toISOString().slice(0, 10);
}
