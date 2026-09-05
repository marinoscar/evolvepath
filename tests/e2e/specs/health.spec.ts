import { test, expect, type Page } from '@playwright/test';

import { loginAsTestUser } from '../helpers/auth.helper';
import { apiPost } from '../helpers/commitments.helper';
import { apiGet, uniqueEmail } from '../helpers/path.helper';
import { enableAi } from '../helpers/weekly.helper';
import {
  approveProgram,
  completeSessionViaApi,
  generateProgram,
  getSession,
  listCommitments,
  moveCommitmentToNow,
  seedProgramViaApi,
  skipCommitment,
  startSession,
  type SeededProgram,
} from '../helpers/workouts.helper';

// =============================================================================
// E09 — the Health domain, end to end (issue #114)
// =============================================================================
//
// PRD §106's list, driven through the browser: create a program → it persists →
// start a workout → log sets → the history is there next session → the small
// versions exist → the coach proposes an adjustment → the user approves it.
// Every one of those crosses the browser, the API and the database, which is
// why they are proved here and not in a unit test.
//
// TWO ASSERTIONS ARE ABOUT WRITES THAT DO NOT HAPPEN, and nothing but a count
// can see them: `commitments` is zero after generating a program (PRD §15 — a
// draft is not a plan), and the workout template's minutes are unchanged after
// the adaptation detector runs (the detector proposes; the user decides).
//
// NOTHING WAITS ON A WEEKDAY OR A CLOCK. `moveCommitmentToNow` reschedules the
// first training day to a minute from now, so the suite runs the same on a
// Sunday, and readiness is polled through the API rather than slept on.
//
// The stack is `base + dev + fake-openai`, with the fake server answering the
// four E09 schema names (`tools/fake-openai/scenarios/index.mjs`).
// =============================================================================

/** A signed-in user with a key and AI enabled — the state every case needs. */
async function signIn(page: Page, prefix: string): Promise<void> {
  await loginAsTestUser(page, {
    email: uniqueEmail(prefix),
    role: 'admin',
    withAiKey: true,
  });

  await enableAi(page);
}

/** The FULL template named `name`. */
function fullTemplate(program: SeededProgram, name = 'Upper A') {
  const template = program.templates.find(
    (row) => row.name === name && row.variant === 'FULL',
  );

  if (!template) throw new Error(`no FULL template called ${name}`);

  return template;
}

test.describe('E09 — the Health domain', () => {
  test('builds a program, and writes nothing until it is approved', async ({ page }) => {
    await signIn(page, 'health-build');

    await page.goto('/health/programs/new');

    await page.getByLabel(/What do you want out of training/).fill('Get stronger');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: '3', exact: true }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Dumbbells' }).click();
    await page.getByRole('button', { name: 'Bench' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByTestId('program-generate').click();

    // Three workouts, each with its three sizes (PRD §44).
    await expect(page.getByTestId('program-template-Upper A')).toBeVisible();
    await expect(page.getByTestId('program-template-Lower')).toBeVisible();
    await expect(page.getByTestId('program-template-Upper B')).toBeVisible();

    const tabs = page.getByTestId('program-template-Upper A').getByRole('tab');
    await expect(tabs).toHaveText(['Full', 'Short', 'Minimum']);

    // PRD §15: a draft is not a plan. Nothing is on the calendar yet.
    expect(await listCommitments(page)).toHaveLength(0);

    await page.getByTestId('program-approve').click();
    await page.getByRole('button', { name: 'Approve' }).last().click();

    await expect(page).toHaveURL(/\/health\/programs\/[0-9a-f-]{36}$/);

    const programId = page.url().split('/').pop()!;
    const program = await apiGet<SeededProgram>(page, `/api/workouts/programs/${programId}`);
    expect(program.status).toBe('ACTIVE');
    expect(program.planId).not.toBeNull();

    const commitments = await listCommitments(page);
    expect(commitments.length).toBeGreaterThanOrEqual(6);
    expect(commitments.every((row) => row.workoutTemplateId)).toBe(true);
  });

  test('falls back to the starter when the draft breaks a safety rule', async ({ page }) => {
    await signIn(page, 'health-unsafe');

    // The fake server answers "shoulder" with five beginner days AND an
    // overhead press — two independent violations.
    const result = await generateProgram(page, {
      limitations: 'my left shoulder is bad',
    });

    expect(result.source).toBe('starter');
    expect(result.reason).toBe('invalid_output');

    // A worse program, and a working one: it can still be approved (PRD §120).
    const approved = await approveProgram(page, result.program.id, {});
    expect(approved.program.status).toBe('ACTIVE');
    expect(approved.commitmentIds.length).toBeGreaterThan(0);
  });

  test('runs a workout from Today and records what happened', async ({ page }) => {
    await signIn(page, 'health-run');
    const { program } = await seedProgramViaApi(page);

    const scheduled = (await listCommitments(page))[0];
    await moveCommitmentToNow(page, scheduled.id);

    await page.goto('/');
    await page.getByRole('button', { name: 'Start workout' }).first().click();

    await expect(page).toHaveURL(/\/workout\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('runner-header')).toContainText(/Workout 1 of 18/);
    await expect(page.getByTestId('runner-last-time').first()).toContainText('Last time: —');

    for (let set = 1; set <= 3; set += 1) {
      await page.getByTestId('runner-weight').getByRole('textbox').fill('20');
      await page.getByTestId('runner-reps').getByRole('textbox').fill('12');
      await page.getByTestId('runner-complete-set').click();

      await expect(page.getByTestId('runner-rest-timer')).toBeVisible();
    }

    const sessionId = page.url().split('/').pop()!;

    await page.getByTestId('runner-finish').click();
    await page.getByRole('button', { name: 'Finish' }).click();

    await expect(page).toHaveURL(/\/$/);

    const session = await getSession(page, sessionId);
    expect(session.status).toBe('COMPLETED');

    // The gym record, separate from the commitment's own completion evidence.
    const evidence = await apiGet<Array<{ source: string; evidenceType: string }>>(
      page,
      `/api/evidence?from=${new Date(Date.now() - 24 * 3600_000).toISOString()}&to=${new Date(
        Date.now() + 3600_000,
      ).toISOString()}`,
    );
    expect(evidence.some((row) => row.source === 'WORKOUT_LOG')).toBe(true);

    void program;
  });

  test('keeps sets logged while the network is gone, and replays them once', async ({
    page,
    context,
  }) => {
    await signIn(page, 'health-offline');
    const { program } = await seedProgramViaApi(page);
    const template = fullTemplate(program);

    const session = await startSession(page, { templateId: template.id, variant: 'FULL' });
    await page.goto(`/workout/${session.id}`);
    await expect(page.getByTestId('runner-complete-set')).toBeVisible();

    await context.setOffline(true);

    for (let set = 1; set <= 2; set += 1) {
      await page.getByTestId('runner-weight').getByRole('textbox').fill('20');
      await page.getByTestId('runner-reps').getByRole('textbox').fill('12');
      await page.getByTestId('runner-complete-set').click();
    }

    // The user did those sets. The screen keeps them, badged.
    await expect(page.getByLabel('Saved on this device')).toHaveCount(2);

    await context.setOffline(false);

    await expect
      .poll(async () => (await getSession(page, session.id)).exercises[0].logged.length, {
        timeout: 20_000,
      })
      .toBe(2);

    // Replayed, not duplicated: `clientId` is unique and the server says
    // "already have it" rather than writing a second row.
    const replayed = await getSession(page, session.id);
    const clientIds = replayed.exercises.flatMap((row) =>
      row.logged.map((set) => set.clientId),
    );
    expect(new Set(clientIds).size).toBe(clientIds.length);
  });

  test('remembers last time and suggests a small increase', async ({ page }) => {
    await signIn(page, 'health-progress');
    const { program } = await seedProgramViaApi(page);
    const template = fullTemplate(program);

    // Two sessions at the top of the range. Conservative means two, not one.
    await completeSessionViaApi(page, { templateId: template.id, weightKg: 20, reps: 12 });
    await completeSessionViaApi(page, { templateId: template.id, weightKg: 20, reps: 12 });

    const third = await startSession(page, { templateId: template.id, variant: 'FULL' });
    await page.goto(`/workout/${third.id}`);

    await expect(page.getByTestId('runner-last-time').first()).toContainText('20 kg × 12');
    await expect(page.getByTestId('runner-progression-chip').first()).toContainText('22.5');

    await page.getByTestId('runner-progression-chip').first().click();
    await expect(page.getByText(/22\.5/).last()).toBeVisible();
  });

  test('stops coaching when a set hurts', async ({ page }) => {
    await signIn(page, 'health-pain');
    const { program } = await seedProgramViaApi(page);
    const template = fullTemplate(program);

    const session = await startSession(page, { templateId: template.id, variant: 'FULL' });
    await page.goto(`/workout/${session.id}`);

    await page.getByTestId('runner-weight').getByRole('textbox').fill('20');
    await page.getByTestId('runner-reps').getByRole('textbox').fill('6');
    await page.getByRole('button', { name: 'Sharp pain' }).click();
    await page.getByTestId('runner-complete-set').click();

    const card = page.getByTestId('runner-safety-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/professional/);

    // Stop, and stop. No programming advice on this path.
    await expect(card.getByRole('button', { name: 'Stop this exercise' })).toBeVisible();
    await expect(page.getByTestId('runner-complete-set')).toHaveCount(0);
  });

  test('looks at a filmed set without diagnosing anything', async ({ page }) => {
    await signIn(page, 'health-form');
    const { program } = await seedProgramViaApi(page);
    const template = fullTemplate(program);

    const session = await startSession(page, { templateId: template.id, variant: 'FULL' });
    await page.goto(`/workout/${session.id}`);

    await page.getByTestId('runner-form-check').first().click();
    await page
      .getByLabel('Record a video of your set')
      .setInputFiles('fixtures/media/clip.mp4');

    await page.getByRole('button', { name: 'Ask the coach' }).click();

    const result = page.getByTestId('form-check-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText('Try this next set');
    await expect(result).toContainText('Nothing stood out');
  });

  test('proposes a shorter session after two skips, and changes nothing until accepted', async ({
    page,
  }) => {
    await signIn(page, 'health-adapt');
    const { program } = await seedProgramViaApi(page);
    const template = fullTemplate(program);

    const scheduled = (await listCommitments(page)).filter(
      (row) => row.workoutTemplateId === template.id,
    );
    await skipCommitment(page, scheduled[0].id);
    await skipCommitment(page, scheduled[1].id);

    const run = await apiPost<{ created: number; proposalIds: string[] }>(
      page,
      '/api/workouts/adaptation/run',
      {},
    );
    expect(run.created).toBe(1);

    // Proposed, not applied.
    const before = await apiGet<SeededProgram>(page, `/api/workouts/programs/${program.id}`);
    expect(fullTemplate(before).targetMinutes).toBe(template.targetMinutes);

    await apiPost(page, `/api/proposals/${run.proposalIds[0]}/accept`, {});

    const after = await apiGet<SeededProgram>(page, `/api/workouts/programs/${program.id}`);
    expect(fullTemplate(after).targetMinutes).toBeLessThan(template.targetMinutes);
  });

  test('draws a weight trend and never judges a day', async ({ page }) => {
    await signIn(page, 'health-weight');

    for (let daysAgo = 8; daysAgo >= 1; daysAgo -= 1) {
      await apiPost(page, '/api/health/weight', {
        dateLocal: new Date(Date.now() - daysAgo * 24 * 3600_000).toISOString().slice(0, 10),
        weightKg: 83 - daysAgo * 0.1,
      });
    }

    await page.goto('/health');

    await page.getByTestId('weight-value').getByRole('textbox').fill('82.4');
    await page.getByTestId('weight-save').click();

    await expect(page.getByTestId('weight-trend-line').first()).toBeVisible();
    await expect(page.getByText(/7-day trend: [−-]?\d+\.\d kg/)).toBeVisible();

    // PRD §47: one measurement is never a bad day.
    await expect(page.locator('body')).not.toContainText(/bad day/i);
  });

  test('reads a meal at the level of habits', async ({ page }) => {
    await signIn(page, 'health-meal');

    await page.goto('/');
    await page.getByRole('button', { name: /Add|Quick add/ }).first().click();
    await page.getByTestId('quickadd-meal-check').click();

    await page.getByLabel('Photograph your meal').setInputFiles('fixtures/media/photo.jpg');
    await page.getByRole('button', { name: 'Check' }).click();

    const result = page.getByTestId('meal-check-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText(/protein source/);
    await expect(result).toContainText('I look at habits, not calories.');
    await expect(result).not.toContainText(/kcal|grams? of/i);
  });

  test('runs full screen, with no navigation behind it', async ({ page }) => {
    await signIn(page, 'health-fullscreen');
    const { program } = await seedProgramViaApi(page);
    const template = fullTemplate(program);

    const session = await startSession(page, { templateId: template.id, variant: 'FULL' });
    await page.goto(`/workout/${session.id}`);

    await expect(page.getByTestId('runner-header')).toBeVisible();

    // PRD §11: the runner replaces the navigation — by never mounting it.
    await expect(page.locator('nav')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });
});
