import { http, HttpResponse } from 'msw';

import type {
  BestSelfProfile,
  Commitment,
  CommitmentStatus,
  Domain,
  DomainMode,
  Evidence,
  Outcome,
  Plan,
  PlanVersion,
  Routine,
} from '../../types';
import { canTransition, allowedTransitions } from '../../utils/commitmentTransitions';

// =============================================================================
// A stateful in-memory EvolvePath API (issue #56, epic #33)
// =============================================================================
//
// STATEFUL, not a table of canned responses, and that is the point. The Path
// screen's whole job is a sequence — create an outcome, plan it, version the
// plan, activate the version, commit, start, complete — and every step's
// meaning depends on the last one having happened. A fixture-per-request mock
// can assert that a button fires a request; it cannot assert that activating
// v2 makes v1 SUPERSEDED, which is what PRD §103 actually asks for.
//
// THE TRANSITION MATRIX IS ENFORCED HERE, through the same
// `utils/commitmentTransitions` the UI uses, and a forbidden move answers 409
// with `details.reason = 'INVALID_TRANSITION'` exactly as the API does. A mock
// that accepted every transition would let page tests pass against behaviour
// the real API rejects — which is worse than no test, because it reads as
// coverage.
//
// `resetPathState()` runs from the global `afterEach`, so no test inherits
// another's outcomes.
// =============================================================================

const API_BASE = '*/api';

interface PathState {
  bestSelf: BestSelfProfile | null;
  outcomes: Outcome[];
  plans: Plan[];
  versions: PlanVersion[];
  routines: Routine[];
  commitments: Commitment[];
  evidence: Evidence[];
  domainModes: DomainMode[];
  sequence: number;
}

function emptyState(): PathState {
  return {
    bestSelf: null,
    outcomes: [],
    plans: [],
    versions: [],
    routines: [],
    commitments: [],
    evidence: [],
    domainModes: (['WORK', 'FAMILY', 'HEALTH'] as Domain[]).map((domain) => ({
      domain,
      mode: 'GROW',
      reason: null,
      effectiveFrom: null,
    })),
    sequence: 0,
  };
}

let state: PathState = emptyState();

export function resetPathState(): void {
  state = emptyState();
}

/** Deterministic ids, so a failing assertion names something readable. */
function nextId(prefix: string): string {
  state.sequence += 1;
  return `${prefix}-${state.sequence}`;
}

const now = () => new Date().toISOString();

/** Seeds a state directly, for tests that start from an existing Path. */
export function seedPathState(patch: Partial<PathState>): void {
  state = { ...state, ...patch };
}

export function getPathState(): Readonly<PathState> {
  return state;
}

/**
 * Insert a commitment into the SAME store `/commitments` reads.
 *
 * The family handlers materialize occurrences through this rather than keeping
 * their own list: a ritual whose occurrences did not appear on
 * `GET /commitments` would be a mock of an API that does not exist.
 */
export function insertCommitment(partial: Partial<Commitment>): Commitment {
  const created: Commitment = {
    id: nextId('commitment'),
    domain: 'FAMILY',
    title: 'Commitment',
    outcomeId: null,
    planVersionId: null,
    routineId: null,
    ritualId: null,
    familyMemberId: null,
    scheduledStart: now(),
    scheduledEnd: null,
    importance: 3,
    commitmentType: null,
    fullVersion: null,
    shortVersion: null,
    minimumVersion: null,
    fullMinutes: null,
    shortMinutes: null,
    minimumMinutes: null,
    status: 'PLANNED',
    allowedTransitions: [],
    rescheduleCount: 0,
    rescheduledFromId: null,
    rescheduledToId: null,
    skipReason: null,
    userConfirmed: false,
    startedAt: null,
    completedAt: null,
    evidenceCount: 0,
    createdAt: now(),
    updatedAt: now(),
    ...partial,
  };

  state.commitments.push(created);
  return created;
}

/** The commitments currently in the store, for the family summary handler. */
export function allCommitments(): readonly Commitment[] {
  return state.commitments;
}

// --- Builders ---------------------------------------------------------------

export function makeOutcome(overrides: Partial<Outcome> = {}): Outcome {
  return {
    id: nextId('outcome'),
    domain: 'HEALTH',
    title: 'Three strength workouts per week',
    description: null,
    targetDate: null,
    importance: 4,
    motivation: null,
    state: 'ACTIVE',
    successDefinition: null,
    userConfidence: null,
    archivedAt: null,
    planId: null,
    activePlanVersion: null,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function planDto(plan: Plan): Plan {
  const versions = state.versions.filter((version) => version.planId === plan.id);
  const active = versions.find((version) => version.status === 'ACTIVE') ?? null;
  return {
    ...plan,
    activeVersion: active ? summary(active) : null,
    versionCount: versions.length,
  };
}

function summary(version: PlanVersion) {
  const routineCount = state.routines.filter((r) => r.planVersionId === version.id).length;
  return {
    id: version.id,
    version: version.version,
    status: version.status,
    rationale: version.rationale,
    createdBy: version.createdBy,
    userApproved: version.userApproved,
    previousVersionId: version.previousVersionId,
    activeFrom: version.activeFrom,
    activeUntil: version.activeUntil,
    routineCount,
    createdAt: version.createdAt,
  };
}

/** Keeps each outcome's denormalised plan pointers in step with the stores. */
function outcomeDto(outcome: Outcome): Outcome {
  const plan = state.plans.find((entry) => entry.outcomeId === outcome.id) ?? null;
  const active = plan
    ? (state.versions.find((v) => v.planId === plan.id && v.status === 'ACTIVE') ?? null)
    : null;
  return {
    ...outcome,
    planId: plan?.id ?? null,
    activePlanVersion: active ? { id: active.id, version: active.version } : null,
  };
}

function commitmentDto(commitment: Commitment): Commitment {
  return {
    ...commitment,
    allowedTransitions: [...allowedTransitions(commitment.status)],
    evidenceCount: state.evidence.filter((e) => e.commitmentId === commitment.id).length,
  };
}

const ok = <T>(data: T) => HttpResponse.json({ data, meta: { timestamp: now() } });

const notFound = (what: string) =>
  HttpResponse.json(
    { statusCode: 404, code: 'NOT_FOUND', message: `${what} not found` },
    { status: 404 },
  );

// --- Handlers ---------------------------------------------------------------

export const pathHandlers = [
  // Best Self ----------------------------------------------------------------
  http.get(`${API_BASE}/me/best-self`, () => ok(state.bestSelf)),

  http.put(`${API_BASE}/me/best-self`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    state.bestSelf = {
      id: state.bestSelf?.id ?? nextId('best-self'),
      identityStatement: (body.identityStatement as string | null) ?? null,
      workIdentity: (body.workIdentity as string | null) ?? null,
      familyIdentity: (body.familyIdentity as string | null) ?? null,
      healthIdentity: (body.healthIdentity as string | null) ?? null,
      sixMonthVision: (body.sixMonthVision as string | null) ?? null,
      motivations: (body.motivations as string[]) ?? [],
      reasons: (body.reasons as string[]) ?? [],
      // Stamped on every replacement, exactly as the API does.
      lastReviewedAt: now(),
      createdAt: state.bestSelf?.createdAt ?? now(),
      updatedAt: now(),
    };
    return ok(state.bestSelf);
  }),

  // Domain modes -------------------------------------------------------------
  http.get(`${API_BASE}/me/domain-modes`, () => ok(state.domainModes)),

  http.put(`${API_BASE}/me/domain-modes/:domain`, async ({ params, request }) => {
    const domain = params.domain as Domain;
    const body = (await request.json()) as { mode: DomainMode['mode']; reason?: string | null };
    const updated: DomainMode = {
      domain,
      mode: body.mode,
      reason: body.reason ?? null,
      effectiveFrom: now(),
    };
    state.domainModes = state.domainModes.map((entry) =>
      entry.domain === domain ? updated : entry,
    );
    return ok(updated);
  }),

  // Outcomes -----------------------------------------------------------------
  http.get(`${API_BASE}/outcomes`, ({ request }) => {
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get('includeArchived') === 'true';
    const domain = url.searchParams.get('domain') as Domain | null;

    const visible = state.outcomes
      .filter((outcome) => includeArchived || outcome.state !== 'ARCHIVED')
      .filter((outcome) => !domain || outcome.domain === domain)
      .map(outcomeDto);

    return ok(visible);
  }),

  http.post(`${API_BASE}/outcomes`, async ({ request }) => {
    const body = (await request.json()) as Partial<Outcome>;
    const created = makeOutcome({ ...body, importance: body.importance ?? 3 });
    state.outcomes.push(created);
    return HttpResponse.json({ data: outcomeDto(created) }, { status: 201 });
  }),

  http.get(`${API_BASE}/outcomes/:id`, ({ params }) => {
    const outcome = state.outcomes.find((entry) => entry.id === params.id);
    return outcome ? ok(outcomeDto(outcome)) : notFound('Outcome');
  }),

  http.patch(`${API_BASE}/outcomes/:id`, async ({ params, request }) => {
    const index = state.outcomes.findIndex((entry) => entry.id === params.id);
    if (index < 0) return notFound('Outcome');

    if (state.outcomes[index].state === 'ARCHIVED') {
      return HttpResponse.json(
        { statusCode: 409, code: 'CONFLICT', message: 'Outcome is archived' },
        { status: 409 },
      );
    }

    const body = (await request.json()) as Partial<Outcome>;
    state.outcomes[index] = { ...state.outcomes[index], ...body, updatedAt: now() };
    return ok(outcomeDto(state.outcomes[index]));
  }),

  http.post(`${API_BASE}/outcomes/:id/archive`, ({ params }) => {
    const index = state.outcomes.findIndex((entry) => entry.id === params.id);
    if (index < 0) return notFound('Outcome');

    // Idempotent: a second archive changes nothing.
    if (state.outcomes[index].state !== 'ARCHIVED') {
      state.outcomes[index] = {
        ...state.outcomes[index],
        state: 'ARCHIVED',
        archivedAt: now(),
      };
    }
    return ok(outcomeDto(state.outcomes[index]));
  }),

  // Plans --------------------------------------------------------------------
  http.get(`${API_BASE}/outcomes/:id/plans`, ({ params }) => {
    const plans = state.plans.filter((plan) => plan.outcomeId === params.id).map(planDto);
    return ok(plans);
  }),

  http.post(`${API_BASE}/outcomes/:id/plans`, async ({ params, request }) => {
    const outcomeId = params.id as string;
    if (state.plans.some((plan) => plan.outcomeId === outcomeId)) {
      return HttpResponse.json(
        { statusCode: 409, code: 'CONFLICT', message: 'Outcome already has a plan' },
        { status: 409 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const plan: Plan = {
      id: nextId('plan'),
      outcomeId,
      activeVersion: null,
      versionCount: 0,
      createdAt: now(),
    };
    // v1 is ACTIVE and approved immediately — the API's behaviour, mirrored.
    const version: PlanVersion = {
      id: nextId('version'),
      planId: plan.id,
      version: 1,
      status: 'ACTIVE',
      rationale: (body.rationale as string | null) ?? null,
      expectedWeeklyLoad: (body.expectedWeeklyLoad as number | null) ?? null,
      fallbackStrategy: (body.fallbackStrategy as string | null) ?? null,
      createdBy: 'USER',
      userApproved: true,
      previousVersionId: null,
      activeFrom: now(),
      activeUntil: null,
      routineCount: 0,
      createdAt: now(),
      routines: [],
    };

    state.plans.push(plan);
    state.versions.push(version);
    return HttpResponse.json({ data: planDto(plan) }, { status: 201 });
  }),

  http.get(`${API_BASE}/plans/:planId/versions`, ({ params }) => {
    const versions = state.versions
      .filter((version) => version.planId === params.planId)
      .sort((a, b) => b.version - a.version)
      .map(summary);
    return ok(versions);
  }),

  http.get(`${API_BASE}/plans/:planId/versions/:version`, ({ params }) => {
    const version = state.versions.find(
      (entry) => entry.planId === params.planId && entry.version === Number(params.version),
    );
    if (!version) return notFound('Plan version');
    return ok({
      ...summary(version),
      planId: version.planId,
      expectedWeeklyLoad: version.expectedWeeklyLoad,
      fallbackStrategy: version.fallbackStrategy,
      routines: state.routines.filter((routine) => routine.planVersionId === version.id),
    });
  }),

  http.post(`${API_BASE}/plans/:planId/versions`, async ({ params, request }) => {
    const planId = params.planId as string;
    const existing = state.versions.filter((version) => version.planId === planId);

    if (existing.some((version) => version.status === 'DRAFT')) {
      return HttpResponse.json(
        { statusCode: 409, code: 'CONFLICT', message: 'Plan already has a draft' },
        { status: 409 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const active = existing.find((version) => version.status === 'ACTIVE') ?? null;
    const previous = active ?? existing.sort((a, b) => b.version - a.version)[0] ?? null;
    const nextNumber = Math.max(0, ...existing.map((v) => v.version)) + 1;

    const created: PlanVersion = {
      id: nextId('version'),
      planId,
      version: nextNumber,
      status: 'DRAFT',
      rationale: body.rationale as string,
      expectedWeeklyLoad:
        (body.expectedWeeklyLoad as number | null) ?? previous?.expectedWeeklyLoad ?? null,
      fallbackStrategy:
        (body.fallbackStrategy as string | null) ?? previous?.fallbackStrategy ?? null,
      createdBy: 'USER',
      userApproved: false,
      previousVersionId: previous?.id ?? null,
      activeFrom: null,
      activeUntil: null,
      routineCount: 0,
      createdAt: now(),
      routines: [],
    };
    state.versions.push(created);

    // CLONED, not moved — the source version keeps its own routines, which is
    // what makes the history inspectable.
    if ((body.copyRoutinesFrom ?? 'active') === 'active' && previous) {
      for (const routine of state.routines.filter((r) => r.planVersionId === previous.id)) {
        state.routines.push({ ...routine, id: nextId('routine'), planVersionId: created.id });
      }
    }

    return HttpResponse.json(
      {
        data: {
          ...summary(created),
          planId,
          expectedWeeklyLoad: created.expectedWeeklyLoad,
          fallbackStrategy: created.fallbackStrategy,
          routines: state.routines.filter((r) => r.planVersionId === created.id),
        },
      },
      { status: 201 },
    );
  }),

  http.post(`${API_BASE}/plans/:planId/versions/:version/activate`, ({ params }) => {
    const planId = params.planId as string;
    const target = state.versions.find(
      (entry) => entry.planId === planId && entry.version === Number(params.version),
    );
    if (!target) return notFound('Plan version');

    if (target.status !== 'DRAFT') {
      return HttpResponse.json(
        {
          statusCode: 409,
          code: 'CONFLICT',
          message: `v${target.version} is ${target.status} and cannot be activated`,
        },
        { status: 409 },
      );
    }

    // Supersede then activate — both rows move, which is the invariant the
    // page test is actually checking.
    const current = state.versions.find(
      (entry) => entry.planId === planId && entry.status === 'ACTIVE',
    );
    if (current) {
      current.status = 'SUPERSEDED';
      current.activeUntil = now();
    }
    target.status = 'ACTIVE';
    target.activeFrom = now();
    target.userApproved = true;

    return ok({
      ...summary(target),
      planId,
      expectedWeeklyLoad: target.expectedWeeklyLoad,
      fallbackStrategy: target.fallbackStrategy,
      routines: state.routines.filter((r) => r.planVersionId === target.id),
    });
  }),

  http.post(`${API_BASE}/plans/:planId/versions/:version/reject`, ({ params }) => {
    const target = state.versions.find(
      (entry) => entry.planId === params.planId && entry.version === Number(params.version),
    );
    if (!target) return notFound('Plan version');

    if (target.status !== 'DRAFT') {
      return HttpResponse.json(
        {
          statusCode: 409,
          code: 'CONFLICT',
          message: `v${target.version} is ${target.status} and cannot be rejected`,
        },
        { status: 409 },
      );
    }

    target.status = 'REJECTED';
    return ok({
      ...summary(target),
      planId: target.planId,
      expectedWeeklyLoad: target.expectedWeeklyLoad,
      fallbackStrategy: target.fallbackStrategy,
      routines: [],
    });
  }),

  // Routines -----------------------------------------------------------------
  http.get(`${API_BASE}/routines`, ({ request }) => {
    const url = new URL(request.url);
    const planVersionId = url.searchParams.get('planVersionId');
    const includeInactive = url.searchParams.get('includeInactive') === 'true';

    const routines = state.routines
      .filter((routine) => routine.planVersionId === planVersionId)
      .filter((routine) => includeInactive || routine.active);

    return ok(routines);
  }),

  http.post(`${API_BASE}/routines`, async ({ request }) => {
    const body = (await request.json()) as Partial<Routine>;
    const created: Routine = {
      id: nextId('routine'),
      planVersionId: body.planVersionId as string,
      title: body.title ?? 'Routine',
      domain: body.domain ?? 'HEALTH',
      triggerType: body.triggerType ?? 'TIME',
      triggerValue: body.triggerValue ?? null,
      frequency: body.frequency ?? 'WEEKDAYS',
      daysOfWeek: body.daysOfWeek ?? [],
      preferredTime: body.preferredTime ?? null,
      estimatedDurationMin: body.estimatedDurationMin ?? 30,
      minimumDurationMin: body.minimumDurationMin ?? 10,
      fallbackBehavior: body.fallbackBehavior ?? null,
      active: true,
      sortOrder: state.routines.length,
      createdAt: now(),
      updatedAt: now(),
    };
    state.routines.push(created);
    return HttpResponse.json({ data: created }, { status: 201 });
  }),

  http.patch(`${API_BASE}/routines/:id`, async ({ params, request }) => {
    const index = state.routines.findIndex((routine) => routine.id === params.id);
    if (index < 0) return notFound('Routine');

    const body = (await request.json()) as Partial<Routine>;
    state.routines[index] = { ...state.routines[index], ...body, updatedAt: now() };
    return ok(state.routines[index]);
  }),

  http.delete(`${API_BASE}/routines/:id`, ({ params }) => {
    state.routines = state.routines.filter((routine) => routine.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),

  // Commitments --------------------------------------------------------------
  http.get(`${API_BASE}/commitments`, ({ request }) => {
    const url = new URL(request.url);
    const from = new Date(url.searchParams.get('from') ?? 0);
    const to = new Date(url.searchParams.get('to') ?? 0);
    const outcomeId = url.searchParams.get('outcomeId');
    const domain = url.searchParams.get('domain');

    const rows = state.commitments
      .filter((commitment) => !outcomeId || commitment.outcomeId === outcomeId)
      .filter((commitment) => !domain || commitment.domain === domain)
      .filter((commitment) => {
        const start = new Date(commitment.scheduledStart);
        return start >= from && start <= to;
      })
      .sort(
        (a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime(),
      )
      .map(commitmentDto);

    return ok(rows);
  }),

  http.post(`${API_BASE}/commitments`, async ({ request }) => {
    const body = (await request.json()) as Partial<Commitment>;
    const created: Commitment = {
      id: nextId('commitment'),
      domain: body.domain ?? 'HEALTH',
      title: body.title ?? 'Commitment',
      outcomeId: body.outcomeId ?? null,
      planVersionId: body.planVersionId ?? null,
      routineId: body.routineId ?? null,
      ritualId: body.ritualId ?? null,
      familyMemberId: body.familyMemberId ?? null,
      scheduledStart: body.scheduledStart ?? now(),
      scheduledEnd: body.scheduledEnd ?? null,
      importance: body.importance ?? 3,
      commitmentType: body.commitmentType ?? null,
      fullVersion: body.fullVersion ?? null,
      shortVersion: body.shortVersion ?? null,
      minimumVersion: body.minimumVersion ?? null,
      fullMinutes: body.fullMinutes ?? null,
      shortMinutes: body.shortMinutes ?? null,
      minimumMinutes: body.minimumMinutes ?? null,
      status: 'PLANNED',
      allowedTransitions: [],
      rescheduleCount: body.rescheduleCount ?? 0,
      rescheduledFromId: body.rescheduledFromId ?? null,
      rescheduledToId: null,
      skipReason: null,
      userConfirmed: body.userConfirmed ?? false,
      startedAt: null,
      completedAt: null,
      evidenceCount: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    state.commitments.push(created);
    return HttpResponse.json({ data: commitmentDto(created) }, { status: 201 });
  }),

  http.post(`${API_BASE}/commitments/:id/transition`, async ({ params, request }) => {
    const commitment = state.commitments.find((entry) => entry.id === params.id);
    if (!commitment) return notFound('Commitment');

    const body = (await request.json()) as {
      to: CommitmentStatus;
      reason?: string;
      rescheduleTo?: string;
      evidence?: { qualitativeValue?: string; quantitativeValue?: number };
    };

    // The same matrix the UI reads, enforced. A mock that accepted every move
    // would let page tests pass against behaviour the API rejects.
    if (!canTransition(commitment.status, body.to)) {
      return HttpResponse.json(
        {
          statusCode: 409,
          code: 'CONFLICT',
          message: `Cannot move a ${commitment.status} commitment to ${body.to}`,
          details: { reason: 'INVALID_TRANSITION', from: commitment.status, to: body.to },
        },
        { status: 409 },
      );
    }

    let replacement: Commitment | null = null;
    let evidence: Evidence | null = null;

    if (body.to === 'STARTED' && !commitment.startedAt) {
      commitment.startedAt = now();
    }

    if (body.to === 'COMPLETED' || body.to === 'PARTIALLY_COMPLETED') {
      commitment.completedAt = now();

      // Only when the user actually logged something — completion is a status,
      // evidence is a fact somebody asserted.
      if (body.evidence) {
        evidence = {
          id: nextId('evidence'),
          commitmentId: commitment.id,
          evidenceType: body.to === 'COMPLETED' ? 'completion' : 'partial',
          source: 'USER_LOG',
          occurredAt: now(),
          quantitativeValue: body.evidence.quantitativeValue ?? null,
          quantitativeUnit: null,
          qualitativeValue: body.evidence.qualitativeValue ?? null,
          confidence: null,
          createdAt: now(),
        };
        state.evidence.push(evidence);
      }
    }

    if (body.to === 'SKIPPED') {
      commitment.skipReason = body.reason ?? null;
    }

    if (body.to === 'RESCHEDULED' && body.rescheduleTo) {
      const start = new Date(body.rescheduleTo);
      const duration = commitment.scheduledEnd
        ? new Date(commitment.scheduledEnd).getTime() -
          new Date(commitment.scheduledStart).getTime()
        : null;

      replacement = {
        ...commitment,
        id: nextId('commitment'),
        scheduledStart: start.toISOString(),
        scheduledEnd: duration === null ? null : new Date(start.getTime() + duration).toISOString(),
        status: 'PLANNED',
        rescheduledFromId: commitment.id,
        // The count travels with the INTENTION, not the closed row.
        rescheduleCount: commitment.rescheduleCount + 1,
        rescheduledToId: null,
        startedAt: null,
        completedAt: null,
        skipReason: null,
        evidenceCount: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      state.commitments.push(replacement);
      commitment.rescheduledToId = replacement.id;
    }

    commitment.status = body.to;
    commitment.updatedAt = now();

    return ok({
      commitment: commitmentDto(commitment),
      rescheduledTo: replacement ? commitmentDto(replacement) : null,
      evidence,
    });
  }),
];
