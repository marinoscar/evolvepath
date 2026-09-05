import { Injectable } from '@nestjs/common';

import type { CheckInFeelValue } from './today.schema';

// =============================================================================
// The check-in seam (issue #38, epic E05)
// =============================================================================
//
// `GET /today` reads a check-in that E05-03 (#43) is what actually writes. This
// interface is how #38 lands first without either importing a Prisma delegate
// that does not exist yet or pretending the feature is absent.
//
// The null implementation is not a stub in the pejorative sense: "the user has
// not told us how today feels" is the correct answer for every user until they
// tap a chip, and every consumer already has to handle it.
// =============================================================================

export interface CheckInReader {
  /** The user's stated feeling for this local date, or null. */
  readForDate(userId: string, dateLocal: string): Promise<CheckInFeelValue | null>;
}

export const CHECK_IN_READER = Symbol('CHECK_IN_READER');

/**
 * The answer until `daily_check_ins` exists (E05-03, #43), and the correct
 * answer forever for a user who has not checked in today.
 */
@Injectable()
export class NullCheckInReader implements CheckInReader {
  async readForDate(): Promise<CheckInFeelValue | null> {
    return null;
  }
}
