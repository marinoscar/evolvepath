import request from 'supertest';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';

// =============================================================================
// GET /api/notifications — the coaching action buttons (issue #54, epic E12)
// =============================================================================
//
// The property only a full request proves: a coaching row that has been sitting
// in the inbox for a week STILL offers its buttons, even though the
// `notifications` table stores rendered text and no payload. They are re-derived
// from `(eventKey, link)` on every read — which is why the link format is a
// contract rather than a cosmetic detail.
// =============================================================================

const C = '11111111-1111-4111-8111-111111111111';
const N = '22222222-2222-4222-8222-222222222222';

describe('Notification list actions (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'notif-1',
    eventKey: 'coach.family_presence',
    title: 'Phone-free dinner starts in 15 minutes',
    body: 'Phone down, people first.',
    link: `/today?commitment=${C}&action=in&n=${N}`,
    readAt: null,
    createdAt: new Date('2026-09-08T14:40:00.000Z'),
    ...over,
  });

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
    user = await createMockContributorUser(context);
  });

  const listWith = async (rows: ReturnType<typeof row>[]) => {
    context.prismaMock.$transaction.mockResolvedValue([rows, rows.length]);
    const res = await request(context.app.getHttpServer())
      .get('/api/notifications')
      .set(authHeader(user.accessToken))
      .expect(200);
    return res.body.data.items;
  };

  it('rebuilds a coaching row’s buttons from its stored link', async () => {
    const [item] = await listWith([row()]);

    expect(item.actions.map((a: { action: string }) => a.action)).toEqual([
      'in',
      'move',
      'skip',
    ]);
    expect(item.actions[0]).toEqual({
      action: 'in',
      label: "I'm in",
      link: `/today?commitment=${C}&action=in&n=${N}`,
    });
  });

  // Always present, never absent, so a client never has to distinguish "no
  // actions" from "an older server".
  it('answers with an empty list for a foundation event', async () => {
    const [item] = await listWith([
      row({ eventKey: 'security.role_changed', link: '/settings' }),
    ]);

    expect(item.actions).toEqual([]);
  });

  it('answers with an empty list for a coaching event that has no buttons', async () => {
    const [item] = await listWith([
      row({ eventKey: 'coach.weekly_review_ready', link: `/progress/week?n=${N}` }),
    ]);

    expect(item.actions).toEqual([]);
  });

  // The documented degradation: a stored link cannot say which domain the
  // commitment was in, so the precise "Start workout" is not recoverable.
  it('uses the generic start label, which the live SSE event does not', async () => {
    const [item] = await listWith([
      row({
        eventKey: 'coach.commitment_upcoming',
        link: `/today?commitment=${C}&action=start&n=${N}`,
      }),
    ]);

    expect(item.actions[0].label).toBe('Start');
  });

  it('offers nothing when the stored link carries no attribution', async () => {
    const [item] = await listWith([row({ link: '/today' })]);

    expect(item.actions).toEqual([]);
  });

  it('survives a row whose link is null', async () => {
    const [item] = await listWith([row({ link: null })]);

    expect(item.actions).toEqual([]);
  });
});
