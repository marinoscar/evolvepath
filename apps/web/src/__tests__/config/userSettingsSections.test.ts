import { describe, it, expect } from 'vitest';
import {
  USER_SETTINGS_SECTIONS,
  USER_HUB_PATH,
  USER_HUB_TITLE,
} from '../../config/userSettingsSections';
import { settingsPageTitle } from '../../config/adminSections';

/**
 * Issue #126, epic #109. The Notifications card follows the same
 * MANDATORY settings-registry pattern every other `/settings/*` card does
 * (see CLAUDE.md's "MANDATORY: Settings UI Pattern" and
 * `config/userSettingsSections.tsx`'s own header): declared once, here, with
 * NO `permission` field.
 *
 * Every other card under `USER_SETTINGS_SECTIONS` is unpermissioned for the
 * same reason - these are the caller's OWN settings, and the API grants
 * `user_settings:read` / `user_settings:write` to all three roles. A
 * `permission` field on this card would invent an authorization rule the API
 * does not enforce, and would lock a Viewer out of saying how they want to be
 * contacted.
 */
describe('USER_SETTINGS_SECTIONS - Notifications card (issue #126)', () => {
  function findNotificationsCard() {
    for (const section of USER_SETTINGS_SECTIONS) {
      const card = section.cards.find((c) => c.path === '/settings/notifications');
      if (card) return card;
    }
    return undefined;
  }

  it('is present in the registry', () => {
    const card = findNotificationsCard();
    expect(card).toBeDefined();
    expect(card?.title).toBe('Notifications');
  });

  it('declares no permission - reachable by every authenticated user, not gated on a specific one', () => {
    const card = findNotificationsCard();
    expect(card).toBeDefined();
    expect('permission' in (card as object)).toBe(false);
    expect(card?.permission).toBeUndefined();
  });

  it('points at /settings/notifications', () => {
    const card = findNotificationsCard();
    expect(card?.path).toBe('/settings/notifications');
  });

  it('is grouped under Account, not Security - it is about how the account is contacted, not a credential', () => {
    const accountSection = USER_SETTINGS_SECTIONS.find((s) => s.label === 'Account');
    expect(accountSection?.cards.some((c) => c.path === '/settings/notifications')).toBe(
      true,
    );
  });

  // The wider claim: this is not a one-off omission on this card, it is true
  // of the whole per-user registry (see the file's own header comment). A
  // regression that added a permission ANYWHERE in USER_SETTINGS_SECTIONS
  // would be exactly the kind of invented gate that CLAUDE.md's Settings UI
  // Pattern rule 3 warns against.
  it('no card in USER_SETTINGS_SECTIONS declares a permission', () => {
    const allCards = USER_SETTINGS_SECTIONS.flatMap((section) => section.cards);
    for (const card of allCards) {
      expect(card.permission).toBeUndefined();
    }
  });
});

/**
 * The OpenAI API Key card (issue #28, epic #20).
 *
 * The same registry rules as every other card here, plus one that is specific
 * to it: it must NOT gate on a permission, because a Viewer without a key
 * cannot use the application at all — gating the one card that unlocks the app
 * would be the most consequential possible instance of the invented gate
 * CLAUDE.md rule 3 warns against.
 */
describe('USER_SETTINGS_SECTIONS - OpenAI API Key card (issue #28)', () => {
  const aiSection = () => USER_SETTINGS_SECTIONS.find((section) => section.label === 'AI');

  it('leads its AI group', () => {
    expect(aiSection()).toBeDefined();
    // The key comes first: without one the coach cannot run, so the card that
    // unlocks the app sits above the card that inspects what it remembered.
    expect(aiSection()!.cards[0]!.title).toBe('OpenAI API Key');
  });

  it('points at /settings/ai-key with no permission', () => {
    const card = aiSection()!.cards[0]!;
    expect(card.path).toBe('/settings/ai-key');
    expect(card.permission).toBeUndefined();
  });

  it('resolves the AppBar title for its route from the registry', () => {
    expect(
      settingsPageTitle(USER_SETTINGS_SECTIONS, USER_HUB_PATH, USER_HUB_TITLE, '/settings/ai-key'),
    ).toBe('OpenAI API Key');
  });

  it('sits above Security, because supplying a key is mandatory and a PAT is not', () => {
    const labels = USER_SETTINGS_SECTIONS.map((section) => section.label);
    expect(labels.indexOf('AI')).toBeLessThan(labels.indexOf('Security'));
  });
});

/**
 * The AI Memory card (issue #90, epic E06).
 *
 * A REGISTRY ENTRY, not a tab on the key page. CLAUDE.md's settings rules make
 * the distinction: a destination gate is about reachability and a tab gate is
 * about content, and "what does the coach remember about me?" is a different
 * question from "which key pays for it" — not a second view of the same one.
 */
describe('USER_SETTINGS_SECTIONS - AI Memory card (issue #90)', () => {
  const memoryCard = () =>
    USER_SETTINGS_SECTIONS.find((section) => section.label === 'AI')!.cards.find(
      (card) => card.title === 'AI Memory',
    );

  it('is declared in the AI section', () => {
    expect(memoryCard()).toBeDefined();
  });

  it('points at /settings/ai-memory with no permission', () => {
    // Own resource: the controller answers 404 for anyone else's insight
    // rather than gating on a role, so an invented permission here would be
    // exactly the drift CLAUDE.md rule 3 warns about.
    expect(memoryCard()!.path).toBe('/settings/ai-memory');
    expect(memoryCard()!.permission).toBeUndefined();
  });

  it('resolves the AppBar title for its route from the registry', () => {
    expect(
      settingsPageTitle(
        USER_SETTINGS_SECTIONS,
        USER_HUB_PATH,
        USER_HUB_TITLE,
        '/settings/ai-memory',
      ),
    ).toBe('AI Memory');
  });
});
