import { describe, it, expect } from 'vitest';

import {
  parseSentInteractionId,
  stripAttributionParams,
} from '../../utils/notificationLinks';

const N = '22222222-2222-4222-8222-222222222222';
const C = '11111111-1111-4111-8111-111111111111';

describe('parseSentInteractionId (#68)', () => {
  it('reads the attribution off a Today deep link', () => {
    expect(parseSentInteractionId(`/today?commitment=${C}&action=start&n=${N}`)).toBe(N);
  });

  it('reads it off a Start link too', () => {
    expect(parseSentInteractionId(`/start/${C}?n=${N}`)).toBe(N);
  });

  it('reads it from a bare query string', () => {
    expect(parseSentInteractionId(`?n=${N}`)).toBe(N);
  });

  it('is null for a link with no query at all', () => {
    expect(parseSentInteractionId('/today')).toBeNull();
  });

  it('is null for a link with a query but no attribution', () => {
    expect(parseSentInteractionId(`/today?commitment=${C}`)).toBeNull();
  });

  it.each([null, undefined, ''])('is null for %s', (value) => {
    expect(parseSentInteractionId(value)).toBeNull();
  });

  // A link is something a user can edit in their address bar, and this value is
  // posted straight back as an id. Rejecting the malformed case here means the
  // client never sends a request that can only be a 400 or a 404.
  it.each([
    ['not a uuid', 'hello'],
    ['a number', '12345'],
    ['an injection attempt', "' OR 1=1--"],
    ['a truncated uuid', '22222222-2222-4222-8222'],
  ])('rejects %s', (_label, value) => {
    expect(parseSentInteractionId(`/today?n=${encodeURIComponent(value)}`)).toBeNull();
  });
});

describe('stripAttributionParams (#68)', () => {
  it('removes the three coaching params', () => {
    const params = new URLSearchParams({ commitment: C, action: 'start', n: N });

    expect(stripAttributionParams(params).toString()).toBe('');
  });

  // Someone else's params are not this function's to remove.
  it('leaves everything else alone', () => {
    const params = new URLSearchParams({ commitment: C, n: N, tab: 'health' });

    expect(stripAttributionParams(params).get('tab')).toBe('health');
  });

  // `useSearchParams` hands back a live instance; editing it would change what
  // the component is currently rendering from.
  it('does not mutate what it was given', () => {
    const params = new URLSearchParams({ commitment: C });

    stripAttributionParams(params);

    expect(params.get('commitment')).toBe(C);
  });
});
