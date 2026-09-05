import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PERMISSIONS, ROLES } from './roles.constants';

/**
 * A grep-style consistency check between the constants the guards compare
 * against and the rows the seed actually creates (issue #71).
 *
 * This exists because the failure it catches is silent in both directions.
 * `storage:read_any` and `storage:write_any` were documented in CLAUDE.md,
 * declared nowhere, seeded nowhere, and consulted by nothing — and the only
 * symptom was an admin quietly getting a 403 on a route that was supposed to
 * let them through. A permission that exists as a constant but not as a row
 * grants nothing to anybody; a row nobody references is a permission the
 * product cannot use.
 */
describe('storage and RBAC constants agree with the seed', () => {
  const seedSource = readFileSync(
    join(__dirname, '../../../prisma/seed.ts'),
    'utf8',
  );

  it('seeds every permission the code names', () => {
    const missing = Object.values(PERMISSIONS).filter(
      (permission) => !seedSource.includes(`'${permission}'`),
    );

    expect(missing).toEqual([]);
  });

  it('seeds every role the code names', () => {
    const missing = Object.values(ROLES).filter(
      (role) => !seedSource.includes(`'${role}'`),
    );

    expect(missing).toEqual([]);
  });

  it('declares the three storage admin overrides', () => {
    // Named individually rather than left to the loop above, because these
    // three are the ones CLAUDE.md promised and the seed did not deliver.
    expect(PERMISSIONS.STORAGE_READ_ANY).toBe('storage:read_any');
    expect(PERMISSIONS.STORAGE_WRITE_ANY).toBe('storage:write_any');
    expect(PERMISSIONS.STORAGE_DELETE_ANY).toBe('storage:delete_any');
  });

  it('grants the storage overrides to admin and to nobody else', () => {
    // The seed's ROLE_PERMISSIONS block, sliced per role.
    const rolesBlock = seedSource.slice(seedSource.indexOf('ROLE_PERMISSIONS'));
    const adminBlock = rolesBlock.slice(
      rolesBlock.indexOf('admin:'),
      rolesBlock.indexOf('contributor:'),
    );
    const nonAdminBlock = rolesBlock.slice(rolesBlock.indexOf('contributor:'));

    for (const permission of [
      PERMISSIONS.STORAGE_READ_ANY,
      PERMISSIONS.STORAGE_WRITE_ANY,
      PERMISSIONS.STORAGE_DELETE_ANY,
    ]) {
      expect(adminBlock).toContain(`'${permission}'`);
      expect(nonAdminBlock).not.toContain(`'${permission}'`);
    }
  });
});
