import { Chip } from '@mui/material';

import type { FamilyMember } from '../../types';
import { daysUntilBirthday, describeBirthdayCue, todayLocalDate } from '../../utils/birthday';

interface BirthdayCueProps {
  members: FamilyMember[];
  todayLocal?: string;
  /** How many days ahead counts as "coming up". */
  withinDays?: number;
}

/**
 * "🎂 Mia's birthday in 5 days".
 *
 * ONE chip, for the SOONEST birthday inside the window. Three chips on a card
 * header is a list, and a list of birthdays is a calendar — which is a
 * different feature (PRD §69) and explicitly out of this epic's scope.
 *
 * The year is never read: it may be the 1900 placeholder the editor sends when
 * the user does not know it.
 */
export function BirthdayCue({
  members,
  todayLocal = todayLocalDate(),
  withinDays = 7,
}: BirthdayCueProps) {
  const soonest = members
    .map((member) => ({ member, days: daysUntilBirthday(member.birthday, todayLocal) }))
    .filter(
      (entry): entry is { member: FamilyMember; days: number } =>
        entry.days !== null && entry.days <= withinDays,
    )
    .sort((a, b) => a.days - b.days)[0];

  if (!soonest) return null;

  const cue = describeBirthdayCue(soonest.days, withinDays);
  if (!cue) return null;

  // "Birthday in 5 days" → "Mia's birthday in 5 days".
  const label = `🎂 ${soonest.member.nickname}’s ${cue.replace('Birthday', 'birthday')}`;

  return (
    <Chip size="small" variant="outlined" label={label} data-testid="today-birthday-cue" />
  );
}
