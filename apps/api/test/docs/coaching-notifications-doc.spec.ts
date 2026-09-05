import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NotificationSuppressReason } from '@prisma/client';

import {
  COACHING_EVENT_KEYS,
  COPY_ACTION_LABEL_MAX,
  COPY_BODY_MAX,
  COPY_TITLE_MAX,
  COACHING_CATEGORY,
} from '../../src/coaching-notifications/coaching-events';
import { NOTIFICATION_ACTION_KEYS } from '../../src/coaching-notifications/coaching-actions';
import { BANNED_PHRASES } from '../../src/coaching-notifications/copy/banned-phrases';
import { NOTIFICATION_COPY_PROMPT_VERSION } from '../../src/coaching-notifications/copy/notification-copy.schema';
import {
  FATIGUE_THRESHOLD,
} from '../../src/coaching-notifications/policy/fatigue';
import { NOTIFICATION_POLICY_DEFAULTS } from '../../src/coaching-notifications/policy/notification-policy.schema';
import {
  FATIGUE_WINDOW_DAYS,
  IGNORED_AFTER_MS,
} from '../../src/coaching-notifications/interactions/notification-interactions.service';
import {
  SCAN_AHEAD_MS,
  SCAN_BEHIND_MS,
} from '../../src/coaching-notifications/candidates/candidate-scanner.service';
import {
  LEAD_BUCKETS,
  MIN_BUCKET_SENDS,
} from '../../src/coaching-notifications/metrics/notification-metrics';
import {
  MAX_PUSH_ACTIONS,
  PUSH_TTL_SECONDS,
} from '../../src/notifications/channels/push-notification.channel';

// =============================================================================
// docs/specs/coaching-notifications.md against the code it documents (#75)
// =============================================================================
//
// The same bargain the other three spec documents have: whoever touches
// notifications next will read this one, believe it, and ship against it — so a
// stale document is worse than none.
//
// It asserts the DIRECTION THAT ACTUALLY FIRES: every constant the code exports
// appears in the document WITH ITS CURRENT VALUE. Moving the fatigue threshold
// from five to three and leaving the prose alone is the realistic mistake, and a
// document-mentions-the-name check sails straight past it.
//
// ONE DELIBERATE OMISSION, and the spec asserts that it is deliberate: the
// banned-phrase PATTERNS are not reproduced in the document. Sixteen regexes in
// prose are sixteen things to keep in step, and the failure mode of getting that
// wrong is a document describing a rule the code does not have. What the
// document carries instead is the RULE FOR ADDING ONE — blame, urgency, or the
// app having feelings — which does not change when a synonym is added.
// =============================================================================

const DOC_PATH = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'docs',
  'specs',
  'coaching-notifications.md',
);

const doc = readFileSync(DOC_PATH, 'utf8');

describe('docs/specs/coaching-notifications.md', () => {
  it('exists and is substantial', () => {
    expect(doc.length).toBeGreaterThan(5_000);
  });

  describe('the nine categories', () => {
    it.each(COACHING_EVENT_KEYS)('documents %s', (key) => {
      expect(doc).toContain(key);
    });

    it.each(Object.values(COACHING_CATEGORY))('documents category %s', (category) => {
      expect(doc).toContain(category);
    });
  });

  describe('the decision order', () => {
    // Every reason the engine can record has a definition here, or the
    // metrics carry a value nobody can interpret.
    it.each(Object.values(NotificationSuppressReason))('documents %s', (reason) => {
      expect(doc).toContain(reason);
    });

    it('states that the first failing check is the recorded reason', () => {
      expect(doc).toMatch(/first failing check is the recorded reason/i);
    });

    it('names the two categories that survive a paused domain', () => {
      expect(doc).toMatch(/N6 and N8 survive a paused domain/i);
    });
  });

  describe('the constants, with their values', () => {
    it('documents the policy defaults', () => {
      expect(doc).toContain(`${NOTIFICATION_POLICY_DEFAULTS.dailyCap}`);
      expect(doc).toContain(`${NOTIFICATION_POLICY_DEFAULTS.weeklyCap}`);
      expect(doc).toContain(`${NOTIFICATION_POLICY_DEFAULTS.perCommitmentMax}`);
    });

    it('documents the fatigue threshold and its window', () => {
      expect(doc).toContain(`${FATIGUE_THRESHOLD} consecutive ignored`);
      expect(doc).toContain(`${IGNORED_AFTER_MS / 3_600_000}`);
      expect(doc).toContain('FATIGUE_WINDOW_DAYS');
      expect(FATIGUE_WINDOW_DAYS).toBe(7);
    });

    // `\\s+` rather than a literal space: the document is hard-wrapped, so the
    // number and its unit can legitimately land on either side of a newline.
    it('documents the scan window on both sides', () => {
      expect(doc).toMatch(new RegExp(`${SCAN_BEHIND_MS / 60_000}\\s+minutes behind`));
      expect(doc).toMatch(new RegExp(`${SCAN_AHEAD_MS / 60_000}\\s+minutes ahead`));
    });

    it('documents the copy length caps', () => {
      expect(doc).toContain(`COPY_TITLE_MAX = ${COPY_TITLE_MAX}`);
      expect(doc).toContain(`COPY_BODY_MAX = ${COPY_BODY_MAX}`);
      expect(doc).toContain(`COPY_ACTION_LABEL_MAX = ${COPY_ACTION_LABEL_MAX}`);
    });

    it('documents the push TTL and action limit', () => {
      expect(doc).toContain(`${PUSH_TTL_SECONDS / 60} minutes`);
      expect(MAX_PUSH_ACTIONS).toBe(2);
      expect(doc).toMatch(/at most two actions|two action buttons|how many a browser renders/i);
    });

    it('documents the metric buckets and their threshold', () => {
      expect(doc).toContain(LEAD_BUCKETS.join(', '));
      expect(doc).toContain(`MIN_BUCKET_SENDS\` (${MIN_BUCKET_SENDS})`);
    });

    it('documents the prompt version, so a bump is visible in the diff', () => {
      expect(doc).toContain(NOTIFICATION_COPY_PROMPT_VERSION);
    });
  });

  describe('the link and attribution contract', () => {
    it('documents the attribution parameter', () => {
      expect(doc).toContain('?n=<sentInteractionId>');
    });

    it.each(NOTIFICATION_ACTION_KEYS)('documents the %s action', (action) => {
      expect(doc).toContain(action);
    });

    it('says which surface records which kind', () => {
      for (const kind of ['OPENED', 'ACTIONED', 'DISMISSED']) {
        expect(doc).toContain(kind);
      }
    });
  });

  describe('the tone rule', () => {
    it('states the bar for adding a banned phrase', () => {
      expect(doc).toMatch(/blame/i);
      expect(doc).toMatch(/urgency/i);
      expect(doc).toMatch(/feelings/i);
    });

    // The deliberate omission, asserted so nobody "fixes" it by pasting the
    // list in and creating a second thing to keep in step.
    it('does not reproduce the pattern list', () => {
      const reproduced = BANNED_PHRASES.filter((phrase) => doc.includes(phrase));

      // The PRD's own example sentence quotes one, which is the point of it.
      expect(reproduced.length).toBeLessThanOrEqual(1);
    });
  });

  describe('the independence formula', () => {
    it('states the definition PRD §65 turns on', () => {
      expect(doc).toContain('PRD §65');
      expect(doc).toMatch(/before/i);
      expect(doc).toMatch(/null` at zero completions/);
    });

    it('says the progress screen calls the same function', () => {
      expect(doc).toMatch(/independence\(\)/);
    });
  });

  describe('the operational facts', () => {
    it('documents the cron interval and its off switch', () => {
      expect(doc).toContain("@Cron('*/5 * * * *')");
      expect(doc).toContain('COACHING_NOTIFICATIONS_ENABLED');
    });

    it('documents the test hook and its simulated clock', () => {
      expect(doc).toContain('POST /api/auth/test/run-job');
    });

    it('records that there is one process and no lock', () => {
      expect(doc).toMatch(/no distributed lock/i);
    });
  });

  it('records the rejected alternatives', () => {
    expect(doc).toContain('Rejected alternatives');
    expect(doc).toMatch(/Let the copywriter see the caps/i);
    expect(doc).toMatch(/payload column/i);
  });
});
