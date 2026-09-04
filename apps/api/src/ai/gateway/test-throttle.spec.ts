import { TestThrottle, THROTTLE_LIMITS } from './test-throttle';

describe('TestThrottle', () => {
  let throttle: TestThrottle;

  beforeEach(() => {
    jest.useFakeTimers();
    throttle = new TestThrottle();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows the configured number of attempts and denies the next', () => {
    for (let i = 0; i < THROTTLE_LIMITS.admin_test; i += 1) {
      expect(throttle.check('admin_test', 'user-1')).toEqual({ allowed: true });
    }

    const denied = throttle.check('admin_test', 'user-1');

    expect(denied.allowed).toBe(false);
    expect(
      denied.allowed === false ? denied.retryAfterSeconds : 0,
    ).toBeGreaterThanOrEqual(1);
  });

  it('never advises a Retry-After of zero', () => {
    // A 0 invites an immediate retry that is denied again.
    for (let i = 0; i < THROTTLE_LIMITS.admin_test; i += 1) {
      throttle.check('admin_test', 'user-1');
    }

    // 59.9 s in: the oldest hit is a hair from falling out of the window.
    jest.advanceTimersByTime(59_900);

    const denied = throttle.check('admin_test', 'user-1');
    expect(denied).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('allows again once the window has slid past', () => {
    for (let i = 0; i < THROTTLE_LIMITS.admin_test; i += 1) {
      throttle.check('admin_test', 'user-1');
    }
    expect(throttle.check('admin_test', 'user-1').allowed).toBe(false);

    jest.advanceTimersByTime(61_000);

    expect(throttle.check('admin_test', 'user-1')).toEqual({ allowed: true });
  });

  it('keeps buckets and users independent', () => {
    for (let i = 0; i < THROTTLE_LIMITS.admin_test; i += 1) {
      throttle.check('admin_test', 'user-1');
    }

    // Same user, different surface.
    expect(throttle.check('models_refresh', 'user-1')).toEqual({
      allowed: true,
    });
    // Same surface, different user.
    expect(throttle.check('admin_test', 'user-2')).toEqual({ allowed: true });
  });

  it('gives refresh a looser allowance than the tests', () => {
    // A catalog listing costs no tokens, so it is bounded more loosely.
    expect(THROTTLE_LIMITS.models_refresh).toBeGreaterThan(
      THROTTLE_LIMITS.admin_test,
    );
  });
});
