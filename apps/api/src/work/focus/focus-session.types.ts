import type { CommitmentCard } from '../../commitments/commitment-card.schema';

/**
 * E05-01's timer block, reused verbatim (issue #110, epic E07).
 *
 * An alias rather than a second declaration: the client derives the countdown
 * with `utils/commitmentTimer.ts`, and a focus session that reported a slightly
 * different shape would be a second implementation of the one piece of maths
 * this product deliberately does not duplicate.
 */
export type CommitmentTimer = NonNullable<CommitmentCard['timer']>;
