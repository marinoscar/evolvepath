import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The navigate spy and the shared call log have to exist before the component
// module is imported, because `vi.mock` is hoisted above it.
const navigateSpy = vi.fn();
const callLog: string[] = [];

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => (path: string, opts?: unknown) => {
      callLog.push(`navigate:${path}`);
      navigateSpy(path, opts);
    },
  };
});

import { render } from '../utils/test-utils';
import { AuthContext } from '../../contexts/AuthContext';
import UserDataResetPage from '../../pages/UserDataResetPage';
import {
  getAccountState,
  MOCK_RESET_PHRASES,
} from '../mocks/accountHandlers';

// =============================================================================
// UserDataResetPage — the Danger zone (epic #220, #224)
// =============================================================================
//
// Driven against the real hook and the real in-memory store, so every assertion
// here covers form -> hook -> api.ts -> MSW -> refetch rather than proving that
// a callback fired.
//
// The ordering test is the one this page exists to get right. Both shell gates
// read the single `AuthContext` user, so `refreshUser()` must RESOLVE before
// `navigate()` runs — navigating first lands the user behind a gate still
// holding the pre-reset answer, which reads as the reset not having worked at
// all. Asserting "both were called" would pass against exactly that bug, so
// this asserts the ORDER, through one shared call log.
// =============================================================================

let refreshUser: ReturnType<typeof vi.fn>;

/**
 * The page is wrapped in its OWN `AuthContext.Provider` rather than leaning on
 * `renderWithProviders`' built-in one, because the ordering assertion needs a
 * `refreshUser` this file can watch and the shared helper mints its own spy
 * internally. The inner provider wins for `useAuth()`, so the outer one is
 * still there doing its ordinary job for everything else.
 */
function renderPage() {
  refreshUser = vi.fn(async () => {
    callLog.push('refreshUser');
  });

  return render(
    <AuthContext.Provider
      value={
        {
          user: null,
          isLoading: false,
          isAuthenticated: true,
          providers: [],
          login: vi.fn(),
          logout: vi.fn(),
          refreshUser,
        } as never
      }
    >
      <UserDataResetPage />
    </AuthContext.Provider>,
    { wrapperOptions: { route: '/settings/reset' } },
  );
}

async function completeReset(panelName: RegExp, phrase: string) {
  const user = userEvent.setup();

  await user.click(await screen.findByRole('button', { name: panelName }));

  const dialog = await screen.findByRole('dialog');
  const input = within(dialog).getByLabelText(new RegExp(phrase, 'i'));
  await user.type(input, phrase);

  const confirm = within(dialog).getAllByRole('button', { name: panelName })[0];
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);
}

beforeEach(() => {
  navigateSpy.mockClear();
  callLog.length = 0;
});

describe('UserDataResetPage — what it shows', () => {
  it('renders both scopes as their own panels', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { name: /reset my data/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /reset everything/i }),
    ).toBeInTheDocument();
  });

  it('renders the live counts from the summary, not a static warning', async () => {
    renderPage();

    expect(await screen.findByText(/4 commitments/i)).toBeInTheDocument();
  });

  it('omits a table with a zero count — a reader should not be told about nothing', async () => {
    renderPage();

    await screen.findByText(/4 commitments/i);
    expect(screen.queryByText(/0 weekly reviews/i)).not.toBeInTheDocument();
  });
});

describe('UserDataResetPage — the gate', () => {
  it('sends NOTHING while the typed phrase is wrong', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /^reset my data$/i }),
    );

    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText(/delete my data/i),
      'delete my data',
    );

    // Asserted against the store, not the button: "the button looks disabled"
    // and "no request was made" are different claims, and only the second one
    // is the promise this screen makes.
    expect(getAccountState().recordedResets).toHaveLength(0);
    expect(getAccountState().counts.commitments).toBe(4);
  });

  it('sends the phrase the user TYPED, never the one the page already holds', async () => {
    renderPage();
    await screen.findByText(/4 commitments/i);

    await completeReset(/^reset my data$/i, MOCK_RESET_PHRASES.data);

    await waitFor(() =>
      expect(getAccountState().recordedResets).toHaveLength(1),
    );
    const [sent] = getAccountState().recordedResets;
    expect(sent.scope).toBe('data');
    expect(sent.confirmationPhrase).toBe(MOCK_RESET_PHRASES.data);
  });
});

describe('UserDataResetPage — refresh before navigate', () => {
  it('refreshes the auth user BEFORE navigating, so no gate answers with the pre-reset truth', async () => {
    renderPage();
    await screen.findByText(/4 commitments/i);

    await completeReset(/^reset my data$/i, MOCK_RESET_PHRASES.data);

    await waitFor(() => expect(navigateSpy).toHaveBeenCalled());

    expect(refreshUser).toHaveBeenCalledTimes(1);
    expect(callLog.indexOf('refreshUser')).toBeGreaterThanOrEqual(0);
    expect(callLog.indexOf('refreshUser')).toBeLessThan(
      callLog.findIndex((entry) => entry.startsWith('navigate:')),
    );
  });

  it("sends a 'data' reset to /onboarding, because deleting user_profiles genuinely un-onboards them", async () => {
    renderPage();
    await screen.findByText(/4 commitments/i);

    await completeReset(/^reset my data$/i, MOCK_RESET_PHRASES.data);

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith('/onboarding', { replace: true }),
    );
  });

  it("sends a 'data_and_key' reset to /setup/ai-key, the first gate in the chain", async () => {
    renderPage();
    await screen.findByText(/4 commitments/i);

    await completeReset(
      /^reset everything$/i,
      MOCK_RESET_PHRASES.data_and_key,
    );

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith('/setup/ai-key', {
        replace: true,
      }),
    );
    expect(getAccountState().aiKeyConfigured).toBe(false);
  });
});
