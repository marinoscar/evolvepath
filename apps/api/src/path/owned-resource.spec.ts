import { NotFoundException } from '@nestjs/common';

import { findOwnedOrThrow } from './owned-resource';

describe('findOwnedOrThrow', () => {
  it('returns the row when the scoped lookup finds one', async () => {
    const row = { id: 'abc' };

    await expect(findOwnedOrThrow(async () => row, 'Outcome')).resolves.toBe(row);
  });

  it('throws 404 naming the resource when the lookup finds nothing', async () => {
    await expect(findOwnedOrThrow(async () => null, 'Outcome')).rejects.toThrow(
      new NotFoundException('Outcome not found'),
    );
  });

  // The security property this helper exists for: an unowned row and an
  // unknown id must be indistinguishable, so neither may produce a 403.
  it('never throws a 403, which would confirm the row exists', async () => {
    await expect(findOwnedOrThrow(async () => null, 'Plan')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('treats undefined like null', async () => {
    await expect(
      findOwnedOrThrow(async () => undefined as unknown as null, 'Routine'),
    ).rejects.toThrow(NotFoundException);
  });
});
