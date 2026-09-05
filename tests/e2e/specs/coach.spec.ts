import { test, expect, type Page } from '@playwright/test';

import { loginAsTestUser } from '../helpers/auth.helper';
import { uniqueEmail } from '../helpers/path.helper';
import {
  latestConversationId,
  listInsights,
  listMessages,
  listVersions,
  proposeInsights,
  seedCoachFixture,
  type SeededPlan,
} from '../helpers/coach.helper';

// =============================================================================
// E06 — the AI coach, end to end (issue #93)
// =============================================================================
//
// PRD §68 is the epic's whole promise, in one sentence a user types: "My
// schedule changed. I can't work out Wednesday anymore." → the coach queries
// the real plan → proposes an adjustment → the product shows a diff → the user
// approves → the plan becomes v2. Every step of that crosses the browser, the
// API and the database, which is why it is proved here and not in a unit test.
//
// THE CENTRAL ASSERTION IS A COUNT, TAKEN THREE TIMES. `plan_versions` is
// queried before the proposal, after the proposal, and after the accept. PRD
// §89/§107 say the AI never changes a plan without approval, and that is a
// claim about a write that DOESN'T happen — which nothing but a count can see.
//
// The fake OpenAI server answers in character (`tools/fake-openai/scenarios/`)
// rather than with schema-shaped placeholders, and it reads the plan and
// routine ids back out of the rendered context. That is deliberate: a canned
// proposal carrying invented ids would be rejected by the hallucination guard,
// and this suite would then prove only that the guard works.
// =============================================================================

const WEDNESDAY_MESSAGE = "My schedule changed. I can't work out Wednesday anymore.";

async function signInWithAPlan(page: Page): Promise<SeededPlan> {
  await loginAsTestUser(page, {
    email: uniqueEmail('coach'),
    role: 'contributor',
    withAiKey: true,
  });

  return seedCoachFixture(page);
}

/** Type into the composer and wait for the coach's turn to land. */
async function sendToCoach(page: Page, text: string) {
  const composer = page.getByLabel('Message the coach');
  await composer.fill(text);
  await page.getByRole('button', { name: 'Send' }).click();

  // The optimistic bubble, before anything comes back.
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
  await expect(page.getByTestId('coach-thinking')).toHaveCount(0, { timeout: 30_000 });
}

test.describe('E06 — the coach', () => {
  test('a user-initiated plan change becomes v2 only after Accept', async ({ page }) => {
    const seed = await signInWithAPlan(page);

    expect(await listVersions(page, seed.planId)).toHaveLength(1);

    await page.goto('/coach');
    await sendToCoach(page, WEDNESDAY_MESSAGE);

    const card = page.getByTestId('proposal-card');
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('Saturday');
    await expect(card).toContainText('09:00');
    await expect(card).toContainText('18:30');

    // PRD §128: the reasoning is available, and it is a summary — never
    // anything resembling the model's working.
    await page.getByRole('button', { name: /Why this\?/ }).click();
    await expect(page.getByText(/Wednesday evenings no longer work/i)).toBeVisible();

    // Still one version. The coach proposed; nothing changed.
    expect(await listVersions(page, seed.planId)).toHaveLength(1);

    await card.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByText(/Plan updated \(v2\)/)).toBeVisible({ timeout: 15_000 });

    const versions = await listVersions(page, seed.planId);
    expect(versions).toHaveLength(2);

    const v2 = versions.find((version) => version.version === 2)!;
    const v1 = versions.find((version) => version.version === 1)!;

    expect(v2.status).toBe('ACTIVE');
    expect(v2.createdBy).toBe('AI');
    expect(v2.rationale).toContain('Move Wednesday workout to Saturday morning');
    // PRD §103: both sides of the change stay readable.
    expect(v1.status).toBe('SUPERSEDED');

    await page.goto('/path');
    await expect(page.getByText('Move Wednesday workout to Saturday morning')).toBeVisible();
  });

  test('keeping the current plan leaves v1 active', async ({ page }) => {
    const seed = await signInWithAPlan(page);

    await page.goto('/coach');
    await sendToCoach(page, WEDNESDAY_MESSAGE);

    const card = page.getByTestId('proposal-card');
    await expect(card).toBeVisible({ timeout: 30_000 });

    await card.getByRole('button', { name: 'Keep current plan' }).click();
    await expect(page.getByText('Kept current plan')).toBeVisible();

    const versions = await listVersions(page, seed.planId);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.status).toBe('ACTIVE');
  });

  test('a safety redirect answers without calling the coach at all', async ({ page }) => {
    await signInWithAPlan(page);

    await page.goto('/coach');
    await sendToCoach(page, 'I have sharp chest pain when I run');

    // The professional-care copy is a constant, decided by a regex — which is
    // why this path also works when the provider is down.
    await expect(page.getByTestId('safety-note')).toContainText(
      'qualified health professional',
    );
    // No model ran, so there is no reasoning to expand.
    await expect(page.getByRole('button', { name: /Why this\?/ })).toHaveCount(0);
    await expect(page.getByTestId('proposal-card')).toHaveCount(0);

    const conversationId = await latestConversationId(page);
    const messages = await listMessages(page, conversationId);
    const reply = messages[messages.length - 1]!;

    expect(reply.role).toBe('COACH');
    expect(reply.safety?.decision).toBe('redirect');
    expect(reply.structured).toBeNull();
  });

  test('procrastination gets a start action pointing at a real commitment', async ({
    page,
  }) => {
    const seed = await signInWithAPlan(page);

    await page.goto('/coach');
    await page.getByRole('button', { name: "I'm procrastinating" }).click();
    await expect(page.getByTestId('coach-thinking')).toHaveCount(0, { timeout: 30_000 });

    const action = page.getByTestId('recommended-action');
    await expect(action).toBeVisible({ timeout: 30_000 });

    await action.getByRole('button', { name: /Start 10 min/ }).click();

    // The commitment the coach named is the commitment the Start flow opens —
    // which only holds because the id came out of the assembled context and
    // survived the hallucination guard.
    await expect(page).toHaveURL(new RegExp(`/start/${seed.commitmentId}`));
  });

  test('the thread never exposes an invocation id', async ({ page }) => {
    await signInWithAPlan(page);

    await page.goto('/coach');
    await sendToCoach(page, 'How am I doing this week?');

    const conversationId = await latestConversationId(page);
    const messages = await listMessages(page, conversationId);

    // It is a support handle for `ai_invocations`, and a client that had it
    // would turn it into an API.
    expect(JSON.stringify(messages)).not.toContain('invocationId');
  });

  test('memory controls persist across a reload', async ({ page }) => {
    await signInWithAPlan(page);

    const proposed = await proposeInsights(page);
    // The fixture has too little history for the real threshold, so the
    // proposer is expected to decline — the page has to say so rather than
    // looking broken.
    expect(proposed.skipped === 'insufficient_data' || proposed.created.length > 0).toBe(
      true,
    );

    await page.goto('/settings/ai-memory');

    if (proposed.skipped === 'insufficient_data') {
      await page.getByRole('button', { name: 'Propose insights' }).click();
      await expect(page.getByText(/Not enough history yet/)).toBeVisible();
    }

    // Adding one is always available, and is the control the page owns
    // outright.
    await page.getByRole('button', { name: 'Add insight' }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel('Statement')
      .fill('Morning workouts are more reliable for me.');
    await dialog.getByRole('button', { name: 'Add' }).click();

    await expect(
      page.getByText('Morning workouts are more reliable for me.'),
    ).toBeVisible();
    await expect(page.getByText('Added by you')).toBeVisible();

    await page
      .getByRole('switch', {
        name: 'Use "Morning workouts are more reliable for me." for coaching',
      })
      .click();
    await expect(page.getByText('Not used for coaching')).toBeVisible();

    await page.reload();

    await expect(page.getByText('Not used for coaching')).toBeVisible();
    await expect(page.getByText('Confirmed')).toBeVisible();

    const stored = await listInsights(page);
    const added = stored.find(
      (insight) => insight.statement === 'Morning workouts are more reliable for me.',
    )!;
    expect(added.source).toBe('USER');
    expect(added.userConfirmed).toBe(true);
    expect(added.doNotUse).toBe(true);
  });
});

test.describe('E06 — the coach on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the list and the conversation are separate screens', async ({ page }) => {
    await signInWithAPlan(page);

    await page.goto('/coach');

    // One screen at a time: the list has no composer on it.
    await expect(page.getByTestId('conversation-list')).toBeVisible();
    await expect(page.getByLabel('Message the coach')).toHaveCount(0);

    // Starting a thread from the list opens the conversation full-screen.
    await page.getByRole('button', { name: 'New conversation' }).click();
    await sendToCoach(page, 'How am I doing this week?');

    const conversationId = await latestConversationId(page);
    await expect(page).toHaveURL(new RegExp(`/coach/${conversationId}`));

    await page.getByRole('button', { name: 'Back to conversations' }).click();
    await expect(page).toHaveURL(/\/coach$/);
    await expect(page.getByTestId('conversation-list')).toBeVisible();
  });
});
