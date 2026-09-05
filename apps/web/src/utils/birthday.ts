// ===========================================================================
// How far away a birthday is (epic E08, issue #50)
// ===========================================================================
//
// THE YEAR IS IGNORED, ALWAYS. `family_members.birthday` is a calendar date
// whose year may be the 1900 placeholder the editor sends when the user does
// not know it, so anything that read the year would print "126 years old" for
// half the records. Nothing here reads it, and nothing displays it.
//
// Pure day arithmetic on the date STRING, never a `Date` resolved through a
// timezone: a birthday is not an instant, and running it through a zone is how
// a birthday on the 9th becomes the 8th for everyone west of Greenwich.
// ===========================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Days until the next occurrence of this month-and-day, from `todayLocal`.
 *
 * `0` on the day itself, `1..365` otherwise, `null` for no birthday. 29
 * February in a non-leap year is observed on the 28th — the alternative, 1
 * March, moves the cue into a different month, which reads as a mistake.
 */
export function daysUntilBirthday(
  birthday: string | null | undefined,
  todayLocal: string,
): number | null {
  if (!birthday) return null;

  const [, monthText, dayText] = birthday.split('-');
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;

  const [todayYear, todayMonth, todayDay] = todayLocal.split('-').map(Number);
  const today = Date.UTC(todayYear, todayMonth - 1, todayDay);

  for (const year of [todayYear, todayYear + 1]) {
    const observedDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
    const next = Date.UTC(year, month - 1, observedDay);

    if (next >= today) return Math.round((next - today) / DAY_MS);
  }

  return null;
}

/** "Birthday today", "Birthday tomorrow", "Birthday in 5 days", or `null`. */
export function describeBirthdayCue(days: number | null, threshold = 7): string | null {
  if (days === null || days > threshold) return null;
  if (days === 0) return 'Birthday today';
  if (days === 1) return 'Birthday tomorrow';

  return `Birthday in ${days} days`;
}

/** `9 May` — the date without its year, which may be a placeholder. */
export function formatBirthdayWithoutYear(birthday: string | null): string | null {
  if (!birthday) return null;

  const [, month, day] = birthday.split('-').map(Number);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;

  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
    // A fixed leap year, so 29 February formats rather than rolling to 1 March.
    new Date(Date.UTC(2024, month - 1, day)),
  );
}

/** Today's calendar date in the browser's own zone, as `YYYY-MM-DD`. */
export function todayLocalDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
