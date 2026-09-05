import { Domain, DomainModeKind, OutcomeState } from '@prisma/client';

import {
  DOMAINS,
  domainModeKindSchema,
  domainSchema,
  outcomeStateSchema,
} from './domain.schema';

// The point of this file: these Zod enums restate lists that already exist in
// schema.prisma, and a restatement that nobody checks is a restatement that
// drifts. Adding a fourth domain to the schema and not to `domainSchema` would
// otherwise surface as a 400 on a request the database would have accepted.
describe('domain schemas', () => {
  it('mirrors Domain', () => {
    expect(domainSchema.options).toEqual(Object.values(Domain));
  });

  it('mirrors OutcomeState', () => {
    expect(outcomeStateSchema.options).toEqual(Object.values(OutcomeState));
  });

  it('mirrors DomainModeKind', () => {
    expect(domainModeKindSchema.options).toEqual(Object.values(DomainModeKind));
  });

  it('exposes DOMAINS in render order', () => {
    expect(DOMAINS).toEqual(['WORK', 'FAMILY', 'HEALTH']);
  });

  it('rejects a value that is not a domain', () => {
    expect(domainSchema.safeParse('PLAY').success).toBe(false);
  });
});
