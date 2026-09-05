import {
  NOTIFICATION_POLICY_DEFAULTS,
  notificationPolicySchema,
  resolvePolicy,
  resolveQuietHours,
} from './notification-policy.schema';

const profile = (over: Record<string, unknown> = {}) => ({
  timezone: 'America/Costa_Rica',
  quietHoursStart: null as string | null,
  quietHoursEnd: null as string | null,
  notificationPolicy: null as unknown,
  ...over,
});

describe('notificationPolicySchema', () => {
  it('fills every cap from the defaults when nothing is stored', () => {
    expect(notificationPolicySchema.parse({})).toEqual(NOTIFICATION_POLICY_DEFAULTS);
  });

  it.each([
    ['dailyCap', 21],
    ['weeklyCap', 101],
    ['perCommitmentMax', 6],
  ])('rejects %s above its ceiling', (field, value) => {
    const result = notificationPolicySchema.safeParse({ [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it('rejects a negative cap', () => {
    expect(notificationPolicySchema.safeParse({ dailyCap: -1 }).success).toBe(false);
  });

  it('accepts zero, which means "never interrupt me for this"', () => {
    expect(notificationPolicySchema.parse({ dailyCap: 0 }).dailyCap).toBe(0);
  });

  it('rejects a muted category that is not a coaching event key', () => {
    expect(
      notificationPolicySchema.safeParse({ mutedCategories: ['security.role_changed'] })
        .success,
    ).toBe(false);
  });
});

describe('resolvePolicy', () => {
  it('returns the defaults for a profile that has never stored a policy', () => {
    expect(resolvePolicy(profile())).toEqual({
      ...NOTIFICATION_POLICY_DEFAULTS,
      timezone: 'America/Costa_Rica',
      quietHours: null,
    });
  });

  it('degrades to the defaults rather than throwing on an unparseable column', () => {
    const resolved = resolvePolicy(
      profile({ notificationPolicy: { dailyCap: 'four', mutedCategories: 7 } }),
    );

    expect(resolved.dailyCap).toBe(NOTIFICATION_POLICY_DEFAULTS.dailyCap);
    expect(resolved.mutedCategories).toEqual([]);
  });

  it('degrades on a column that is not even an object', () => {
    expect(resolvePolicy(profile({ notificationPolicy: 'nope' })).weeklyCap).toBe(
      NOTIFICATION_POLICY_DEFAULTS.weeklyCap,
    );
  });

  it('keeps the stored values it can read', () => {
    const resolved = resolvePolicy(
      profile({ notificationPolicy: { dailyCap: 2, mutedCategories: ['coach.day_start'] } }),
    );

    expect(resolved.dailyCap).toBe(2);
    expect(resolved.mutedCategories).toEqual(['coach.day_start']);
    // Absent keys still come from the defaults, not from undefined.
    expect(resolved.weeklyCap).toBe(NOTIFICATION_POLICY_DEFAULTS.weeklyCap);
  });

  it('reads quiet hours off the E04-01 columns', () => {
    const resolved = resolvePolicy(
      profile({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }),
    );

    expect(resolved.quietHours).toEqual({ start: '22:00', end: '07:00' });
  });
});

describe('resolveQuietHours', () => {
  it('needs both bounds', () => {
    expect(resolveQuietHours('22:00', null)).toBeNull();
    expect(resolveQuietHours(null, '07:00')).toBeNull();
  });

  it('treats equal bounds as no quiet hours, not as a zero- or 24-hour window', () => {
    expect(resolveQuietHours('22:00', '22:00')).toBeNull();
  });

  it('rejects a value that is not HH:mm', () => {
    expect(resolveQuietHours('10pm', '07:00')).toBeNull();
    expect(resolveQuietHours('24:00', '07:00')).toBeNull();
  });

  it('accepts a window that wraps past midnight', () => {
    expect(resolveQuietHours('22:00', '07:00')).toEqual({ start: '22:00', end: '07:00' });
  });
});
