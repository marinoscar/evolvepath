import { http, HttpResponse } from 'msw';

import type { BodyWeightLog, NutritionBehaviour, WeightTrend } from '../../types';

// =============================================================================
// A stateful in-memory Health API (issue #113, epic E09)
// =============================================================================
//
// STATEFUL, and it enforces what the real API enforces — a mock that accepted
// everything would let page tests pass against behaviour the server refuses,
// which reads as coverage and is worse than none. Specifically:
//
//   * ONE ROW PER LOCAL DATE, upserted, exactly like the API's unique index.
//   * A FUTURE DATE IS A 400 with the same code the API answers.
//   * The trend is the same rolling seven-day mean with the same "null under
//     two readings" rule, so the chart's empty state is exercised for the same
//     reason it happens in production.
//
// `resetHealthState()` runs from the global `afterEach`.
// =============================================================================

const API_BASE = '*/api';

export const MOCK_BEHAVIOURS: NutritionBehaviour[] = [
  {
    key: 'vegetables_with_dinner',
    title: 'Vegetables with dinner',
    description: 'Something green on the plate at dinner. Frozen counts.',
    defaultTime: 'EVENING',
    fullVersion: { title: 'Vegetables with dinner', minutes: 10 },
    minimumVersion: { title: 'One vegetable, however easy', minutes: 3 },
  },
  {
    key: 'protein_with_meals',
    title: 'Protein with every meal',
    description: 'A protein source at each meal, whatever it is.',
    defaultTime: 'MIDDAY',
    fullVersion: { title: 'Protein with every meal', minutes: 5 },
    minimumVersion: { title: 'Protein with one meal', minutes: 2 },
  },
];

interface HealthState {
  weights: BodyWeightLog[];
  committed: Array<{ key: string; repeatDays: number }>;
}

const state: HealthState = { weights: [], committed: [] };

export function resetHealthState(): void {
  state.weights = [];
  state.committed = [];
}

export function seedWeights(entries: BodyWeightLog[]): void {
  state.weights = [...entries];
}

export function committedBehaviours(): ReadonlyArray<{ key: string; repeatDays: number }> {
  return state.committed;
}

function addDays(dateLocal: string, days: number): string {
  const [year, month, day] = dateLocal.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildTrend(from: string, to: string): WeightTrend {
  const byDate = new Map(state.weights.map((row) => [row.dateLocal, row.weightKg]));
  const trend: WeightTrend['trend'] = [];

  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    const values: number[] = [];

    for (let back = 0; back < 7; back += 1) {
      const value = byDate.get(addDays(cursor, -back));
      if (value !== undefined) values.push(value);
    }

    trend.push({
      dateLocal: cursor,
      rolling7Kg:
        values.length >= 2
          ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
          : null,
    });
  }

  const items = state.weights
    .filter((row) => row.dateLocal >= from && row.dateLocal <= to)
    .sort((a, b) => a.dateLocal.localeCompare(b.dateLocal));

  const values = trend
    .map((point) => point.rolling7Kg)
    .filter((value): value is number => value !== null);

  return {
    items,
    trend,
    summary:
      values.length >= 2
        ? {
            first: values[0],
            last: values[values.length - 1],
            deltaKg: Math.round((values[values.length - 1] - values[0]) * 10) / 10,
            days: items.length,
          }
        : null,
  };
}

export const healthHandlers = [
  http.get(`${API_BASE}/nutrition/behaviors`, () =>
    HttpResponse.json({ data: { items: MOCK_BEHAVIOURS } }),
  ),

  http.post(`${API_BASE}/nutrition/behaviors/:key/commit`, async ({ params, request }) => {
    const key = String(params.key);

    if (!MOCK_BEHAVIOURS.some((behaviour) => behaviour.key === key)) {
      return HttpResponse.json({ message: 'Behaviour not found' }, { status: 404 });
    }

    const body = (await request.json()) as { repeatDays?: number };
    const repeatDays = body.repeatDays ?? 1;

    state.committed.push({ key, repeatDays });

    return HttpResponse.json(
      {
        data: {
          commitmentIds: Array.from({ length: repeatDays }, (_, index) => `commitment-${index}`),
        },
      },
      { status: 201 },
    );
  }),

  http.put(`${API_BASE}/health/weight`, async ({ request }) => {
    const body = (await request.json()) as BodyWeightLog;

    if (body.dateLocal > today()) {
      return HttpResponse.json(
        { code: 'WEIGHT_DATE_IN_FUTURE', message: 'That day has not happened yet.' },
        { status: 400 },
      );
    }

    state.weights = [
      ...state.weights.filter((row) => row.dateLocal !== body.dateLocal),
      { dateLocal: body.dateLocal, weightKg: body.weightKg },
    ];

    return HttpResponse.json({ data: body });
  }),

  http.get(`${API_BASE}/health/weight`, ({ request }) => {
    const url = new URL(request.url);
    const to = url.searchParams.get('to') ?? today();
    const from = url.searchParams.get('from') ?? addDays(to, -29);

    return HttpResponse.json({ data: buildTrend(from, to) });
  }),

  http.delete(`${API_BASE}/health/weight/:dateLocal`, ({ params }) => {
    state.weights = state.weights.filter((row) => row.dateLocal !== String(params.dateLocal));

    return new HttpResponse(null, { status: 204 });
  }),
];
