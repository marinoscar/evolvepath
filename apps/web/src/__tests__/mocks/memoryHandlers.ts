import { http, HttpResponse } from 'msw';

import type { MemoryInsight, MemoryInsightCategory } from '../../types';

// =============================================================================
// A stateful in-memory Memory Insights API (issue #90, epic E06)
// =============================================================================
//
// Enforces the rules the real API enforces, for the reason `pathHandlers`
// gives. The two that matter to this page:
//
//   * `GET` WITHOUT `includeDoNotUse` HIDES EXCLUDED ROWS. The settings page
//     always asks for them; a mock that returned everything regardless would
//     let a page that forgot the flag pass.
//   * `PATCH` CONFIRMS. Editing an AI guess is agreement, server-side, and the
//     page's chip flip depends on it.
//
// `resetMemoryState()` runs from the global `afterEach`.
// =============================================================================

const API_BASE = '*/api';

interface MemoryState {
  insights: MemoryInsight[];
  /** What the next `/propose` answers with. */
  nextPropose: { created: MemoryInsight[]; skipped: string | null } | 'throttled';
}

const initial = (): MemoryState => ({
  insights: [],
  nextPropose: { created: [], skipped: null },
});

let state: MemoryState = initial();

export function resetMemoryState(): void {
  state = initial();
}

export function makeInsight(over: Partial<MemoryInsight> = {}): MemoryInsight {
  return {
    id: over.id ?? `insight-${Math.random().toString(36).slice(2, 8)}`,
    category: over.category ?? 'PATTERN',
    statement: over.statement ?? 'Morning workouts are more reliable than evening ones.',
    evidenceCount: over.evidenceCount ?? 12,
    confidence: over.confidence ?? 0.8,
    userConfirmed: over.userConfirmed ?? false,
    doNotUse: over.doNotUse ?? false,
    expiresAt: over.expiresAt ?? null,
    source: over.source ?? 'AI',
    createdAt: over.createdAt ?? new Date().toISOString(),
    updatedAt: over.updatedAt ?? new Date().toISOString(),
  };
}

export function seedInsights(insights: MemoryInsight[]): void {
  state.insights = insights;
}

export function memoryState(): Readonly<MemoryState> {
  return state;
}

export function setNextPropose(next: MemoryState['nextPropose']): void {
  state.nextPropose = next;
}

const find = (id: string) => state.insights.find((insight) => insight.id === id);

export const memoryHandlers = [
  http.get(`${API_BASE}/memory-insights`, ({ request }) => {
    const url = new URL(request.url);
    const includeDoNotUse = url.searchParams.get('includeDoNotUse') === 'true';
    const category = url.searchParams.get('category');

    const items = state.insights.filter(
      (insight) =>
        (includeDoNotUse || !insight.doNotUse) &&
        (!category || insight.category === category),
    );

    return HttpResponse.json({ items });
  }),

  http.post(`${API_BASE}/memory-insights/propose`, () => {
    if (state.nextPropose === 'throttled') {
      return HttpResponse.json(
        { code: 'too_many_requests', retryAfterSeconds: 300 },
        { status: 429 },
      );
    }

    state.insights = [...state.insights, ...state.nextPropose.created];

    return HttpResponse.json(state.nextPropose);
  }),

  http.post(`${API_BASE}/memory-insights`, async ({ request }) => {
    const body = (await request.json()) as {
      category: MemoryInsightCategory;
      statement: string;
    };

    // USER insights arrive confirmed at full confidence: something typed about
    // yourself is confirmed by having been typed.
    const created = makeInsight({
      ...body,
      source: 'USER',
      userConfirmed: true,
      confidence: 1,
      evidenceCount: 0,
    });

    state.insights.push(created);

    return HttpResponse.json(created, { status: 201 });
  }),

  http.patch(`${API_BASE}/memory-insights/:id`, async ({ params, request }) => {
    const insight = find(params.id as string);
    if (!insight) return HttpResponse.json({}, { status: 404 });

    const body = (await request.json()) as { statement: string };
    insight.statement = body.statement;
    // Editing is confirming — "this, but in my words" is agreement.
    insight.userConfirmed = true;

    return HttpResponse.json(insight);
  }),

  http.post(`${API_BASE}/memory-insights/:id/confirm`, ({ params }) => {
    const insight = find(params.id as string);
    if (!insight) return HttpResponse.json({}, { status: 404 });

    insight.userConfirmed = true;
    return HttpResponse.json(insight);
  }),

  http.post(`${API_BASE}/memory-insights/:id/do-not-use`, async ({ params, request }) => {
    const insight = find(params.id as string);
    if (!insight) return HttpResponse.json({}, { status: 404 });

    const body = (await request.json()) as { doNotUse: boolean };
    insight.doNotUse = body.doNotUse;

    return HttpResponse.json(insight);
  }),

  http.delete(`${API_BASE}/memory-insights/:id`, ({ params }) => {
    // A hard delete, like the real one: there is no soft-hidden row left.
    state.insights = state.insights.filter((insight) => insight.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
];
