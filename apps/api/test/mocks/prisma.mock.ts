import { DeepMockProxy, mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

/**
 * Type-safe Prisma mock for testing
 */
export type MockPrismaClient = DeepMockProxy<PrismaClient>;
export type MockPrismaService = DeepMockProxy<PrismaClient>;

/**
 * Global Prisma mock instance
 * Use this in tests with jest-mock-extended
 */
const _prismaMock: MockPrismaClient = mockDeep<PrismaClient>();

// Export as `any` to allow flexible mocking without strict Prisma type checking
// This is intentional - tests need to mock partial responses
export const prismaMock = _prismaMock as any;

/**
 * Alias for backward compatibility
 */
export const mockPrisma = prismaMock;

/**
 * Reset all Prisma mocks
 * Call this in beforeEach() to ensure clean state
 */
export function resetPrismaMock(): void {
  mockReset(prismaMock);
}

/**
 * Helper to mock $transaction - executes callbacks immediately
 */
export function mockPrismaTransaction(): void {
  prismaMock.$transaction.mockImplementation(async (arg: any) => {
    if (typeof arg === 'function') {
      // Interactive transaction
      return arg(prismaMock);
    } else if (Array.isArray(arg)) {
      // Sequential operations
      return Promise.all(arg);
    }
    return arg;
  });
}

/**
 * Creates a fresh mock PrismaService for unit tests.
 *
 * `mockDeep<PrismaClient>()` is structural, so every delegate the generated
 * client exposes is mockable here the moment `prisma:generate` runs — the
 * EvolvePath domain delegates added by #36 (`bestSelfProfile`, `outcome`,
 * `plan`, `planVersion`, `routine`, `commitment`, `evidence`, `reflection`,
 * `domainMode`) included. There is deliberately no hand-maintained list of
 * delegates to extend: one would drift from the schema silently, and a test
 * stubbing a delegate that no longer exists is exactly the failure that list
 * would hide.
 */
export function createMockPrismaService(): MockPrismaService {
  return mockDeep<PrismaClient>();
}
