import { describe, it, expect } from 'vitest';

import { FRICTION_ANSWERS } from '../../../components/work/frictionAnswers';
import type { FrictionAnswer } from '../../../types';

// =============================================================================
// The client's copy of the answer list (issue #118)
// =============================================================================
//
// `components/work/frictionAnswers.ts` is copied from
// `apps/api/src/work/avoidance/friction-answers.ts`. This is what stops the two
// drifting: the union in `types/index.ts` mirrors the API's enum, and every key
// here has to be a member of it — so an answer added or renamed on the server
// fails here rather than silently sending a key the API refuses.
// =============================================================================

const EXPECTED_KEYS: FrictionAnswer[] = [
  'DONT_KNOW_WHERE_TO_BEGIN',
  'TOO_BIG',
  'TIRED',
  'DONT_WANT_TO',
  'SOMETHING_URGENT',
  'WORRIED_ABOUT_QUALITY',
  'NEED_MORE_INFO',
  'OTHER',
];

describe('FRICTION_ANSWERS', () => {
  it('has exactly the eight keys of the FrictionAnswer union, in dialog order', () => {
    expect(FRICTION_ANSWERS.map((option) => option.key)).toEqual(EXPECTED_KEYS);
  });

  it('gives every one a label written in the user\'s own words', () => {
    for (const option of FRICTION_ANSWERS) {
      expect(option.label.length).toBeGreaterThan(3);
      // A label that is the key shouted back is a placeholder somebody forgot.
      expect(option.label).not.toBe(option.key);
    }
  });
});
