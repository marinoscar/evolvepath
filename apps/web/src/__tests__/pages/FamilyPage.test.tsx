import { beforeEach, describe, it, expect } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render, mockAdminUser } from '../utils/test-utils';
import { setViewportWidth } from '../setup';
import {
  getFamilyState,
  makeMember,
  makeRitual,
  seedFamilyState,
} from '../mocks/familyHandlers';
import { insertCommitment } from '../mocks/pathHandlers';
import FamilyPage from '../../pages/FamilyPage';

// =============================================================================
// /path/family (issue #50, epic E08)
// =============================================================================
//
// Three properties this file exists to hold:
//
//   1. THE MEMBER RECORD IS FIVE FIELDS. The editor posts exactly
//      `{nickname, relationship, birthday}` and the card renders nothing else.
//      PRD §33 is a promise about data, and a form that quietly grew a "notes"
//      field would break it silently.
//   2. THE WEEK PANEL IS TWO INTEGERS. No percentage, no bar, no colour scale
//      (VISION §12) — the assertion is `queryByRole('progressbar')` being null,
//      because that is the component a designer would reach for first.
//   3. THE LINT IS A CORRECTION, NOT A REJECTION. A person-targeting title
//      shows under the field before submit, and the rewrite fills the field
//      rather than submitting it.
// =============================================================================

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };
const PHONE = 390;
const DESKTOP = 1280;

function renderFamily() {
  return render(
    <Routes>
      <Route path="/path/family" element={<FamilyPage />} />
    </Routes>,
    { wrapperOptions: { route: '/path/family', user: mockAdminUser } },
  );
}

/** A future instant on a weekday the seeded ritual covers. */
function tomorrowAt(hour: number): string {
  const at = new Date(Date.now() + 24 * 3600_000);
  at.setHours(hour, 30, 0, 0);
  return at.toISOString();
}

describe('FamilyPage', () => {
  beforeEach(() => {
    act(() => setViewportWidth(DESKTOP));
  });

  describe('the empty state', () => {
    it('offers the two things there are to do', async () => {
      renderFamily();

      expect(
        await screen.findByText('Protect what matters before the calendar takes it'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('family-add-member')).toBeInTheDocument();
      expect(screen.getByTestId('family-create-ritual')).toBeInTheDocument();
    });
  });

  describe('family members', () => {
    it('posts exactly nickname, relationship and birthday', async () => {
      renderFamily();

      await userEvent.click(await screen.findByTestId('family-add-member'));
      await userEvent.type(screen.getByTestId('member-nickname'), 'Mia');
      await userEvent.click(screen.getByTestId('member-save'));

      await waitFor(() => expect(getFamilyState().members).toHaveLength(1));

      const [member] = getFamilyState().members;
      expect(member).toMatchObject({ nickname: 'Mia', relationship: 'PARTNER', birthday: null });
      // The whole record, and no sixth key.
      expect(Object.keys(member).sort()).toEqual(
        ['birthday', 'createdAt', 'id', 'nickname', 'relationship'].sort(),
      );
    });

    it('shows the card with the relationship and nothing else', async () => {
      seedFamilyState({ members: [makeMember({ nickname: 'Mia', relationship: 'CHILD' })] });
      renderFamily();

      expect(await screen.findByText('Mia · Child')).toBeInTheDocument();
    });

    it('shows a birthday cue inside the window', async () => {
      const soon = new Date(Date.now() + 5 * 24 * 3600_000);
      const birthday = `1900-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(
        soon.getDate(),
      ).padStart(2, '0')}`;

      seedFamilyState({ members: [makeMember({ nickname: 'Mia', birthday })] });
      renderFamily();

      expect(await screen.findByTestId('today-birthday-cue')).toHaveTextContent(
        /Mia.s birthday in 5 days/,
      );
    });

    it('never prints the placeholder year', async () => {
      seedFamilyState({ members: [makeMember({ nickname: 'Mia', birthday: '1900-05-09' })] });
      renderFamily();

      await screen.findByText('Mia · Child');
      expect(screen.queryByText(/1900/)).not.toBeInTheDocument();
    });
  });

  describe('rituals', () => {
    it('posts the ritual body and shows the card', async () => {
      renderFamily();

      await userEvent.click(await screen.findByTestId('family-create-ritual'));
      await userEvent.type(screen.getByTestId('ritual-title'), 'Phone-free dinner');
      await userEvent.click(screen.getByLabelText('Tuesday'));
      await userEvent.click(screen.getByLabelText('Thursday'));
      await userEvent.click(screen.getByLabelText('Sunday'));
      await userEvent.click(screen.getByTestId('ritual-save'));

      await waitFor(() => expect(getFamilyState().rituals).toHaveLength(1));

      expect(getFamilyState().rituals[0]).toMatchObject({
        title: 'Phone-free dinner',
        recurrence: { weekdays: [0, 2, 4], time: '18:30', everyNWeeks: 1 },
        idealMinutes: 45,
        minimumMinutes: 10,
      });

      expect(await screen.findByText('Tue, Thu, Sun · 18:30 · 45 min (min 10)')).toBeInTheDocument();
    });

    it('shows the lint error under the field, and fills — never submits — the rewrite', async () => {
      renderFamily();

      await userEvent.click(await screen.findByTestId('family-create-ritual'));
      await userEvent.type(screen.getByTestId('ritual-title'), 'Make Mia happier');

      expect(
        await screen.findByText(
          'Describe what you will do, not how someone else should feel or behave.',
          {},
          { timeout: 3000 },
        ),
      ).toBeInTheDocument();

      await userEvent.click(await screen.findByTestId('ritual-suggest-rewrite'));

      await waitFor(() =>
        expect(screen.getByTestId('ritual-title')).toHaveValue('Read with Mia for 15 minutes'),
      );
      // Filled, not saved.
      expect(getFamilyState().rituals).toHaveLength(0);
    });

    it('shows the error with no rewrite button when the coach is unavailable', async () => {
      seedFamilyState({ suggestion: null });
      renderFamily();

      await userEvent.click(await screen.findByTestId('family-create-ritual'));
      await userEvent.type(screen.getByTestId('ritual-title'), 'Make Mia happier');

      expect(
        await screen.findByText(
          'Describe what you will do, not how someone else should feel or behave.',
          {},
          { timeout: 3000 },
        ),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('ritual-suggest-rewrite')).not.toBeInTheDocument();
    });

    it('marks a paused ritual rather than hiding it', async () => {
      seedFamilyState({ rituals: [makeRitual({ active: false })] });
      renderFamily();

      expect(await screen.findByText('Paused')).toBeInTheDocument();
    });

    it('says what a delete costs before doing it', async () => {
      const ritual = makeRitual();
      seedFamilyState({ rituals: [ritual] });
      renderFamily();

      await userEvent.click(await screen.findByLabelText('Actions for Phone-free dinner'));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

      expect(
        screen.getByText('Future occurrences will be cancelled. Past ones stay on your record.'),
      ).toBeInTheDocument();
    });

    it('pauses a ritual by sending active: false', async () => {
      seedFamilyState({ rituals: [makeRitual()] });
      renderFamily();

      await userEvent.click(await screen.findByLabelText('Actions for Phone-free dinner'));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Pause' }));

      await waitFor(() => expect(getFamilyState().rituals[0].active).toBe(false));
    });
  });

  describe('the week panel', () => {
    it('shows planned and kept as integers, with no bar or percentage', async () => {
      const ritual = makeRitual();
      seedFamilyState({ rituals: [ritual] });

      insertCommitment({ ritualId: ritual.id, status: 'COMPLETED', scheduledStart: tomorrowAt(18) });
      insertCommitment({ ritualId: ritual.id, status: 'PLANNED', scheduledStart: tomorrowAt(19) });
      insertCommitment({ ritualId: ritual.id, status: 'SKIPPED', scheduledStart: tomorrowAt(20) });

      renderFamily();

      const panel = await screen.findByTestId('family-week-panel');
      expect(within(panel).getByText(/Planned 3 · Kept 1/)).toBeInTheDocument();
      expect(within(panel).getByText('1 skipped')).toBeInTheDocument();

      // VISION §12: a bar is a score with a shape.
      expect(within(panel).queryByRole('progressbar')).not.toBeInTheDocument();
      expect(within(panel).queryByText(/%/)).not.toBeInTheDocument();
    });
  });

  describe('upcoming occurrences', () => {
    it('lists the next seven days with family words on the actions', async () => {
      const ritual = makeRitual();
      seedFamilyState({ rituals: [ritual] });
      insertCommitment({
        ritualId: ritual.id,
        title: 'Phone-free dinner',
        status: 'PLANNED',
        scheduledStart: tomorrowAt(18),
        fullMinutes: 45,
      });

      renderFamily();

      expect(await screen.findByRole('button', { name: /I'm in: Phone-free dinner/ })).toBeInTheDocument();
    });
  });

  describe('layout and accessibility', () => {
    // MUI gives both a Drawer's paper and a Dialog's paper `role="dialog"`, so
    // the surface is identified by its own class rather than by role.
    it('opens the editor as a bottom sheet on a phone', async () => {
      act(() => setViewportWidth(PHONE));
      renderFamily();

      await userEvent.click(await screen.findByTestId('family-create-ritual'));

      const surface = await screen.findByRole('dialog');
      expect(surface.className).toContain('MuiDrawer-paper');
      expect(surface.className).not.toContain('MuiDialog-paper');
    });

    it('opens the editor as a dialog on a wide screen', async () => {
      renderFamily();

      await userEvent.click(await screen.findByTestId('family-create-ritual'));

      const surface = await screen.findByRole('dialog');
      expect(surface.className).toContain('MuiDialog-paper');
      expect(surface.className).not.toContain('MuiDrawer-paper');
    });

    it('has no axe violations', async () => {
      seedFamilyState({
        members: [makeMember()],
        rituals: [makeRitual()],
      });
      const { container } = renderFamily();

      await screen.findByText('Phone-free dinner');

      expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
    });
  });
});
