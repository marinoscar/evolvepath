// =============================================================================
// Coach dependency, before there is anything to read (issue #98, epic E11)
// =============================================================================
//
// PRD §75 lists "Coach dependency: percent completed without reminder" as a
// Progress section, and §65 makes reducing it the product's stated goal. The
// data it needs — which completions followed a coaching message — is written by
// E12's `notification_interactions`, which does not exist yet.
//
// So the seam is declared here and filled by a null implementation. The
// alternative, omitting the field until E12, would mean the Progress screen
// grows a new section later and every client learns about it twice. A `null`
// ratio is a complete answer: the UI renders "Available once notifications
// learn your rhythm" and nothing has to change when the real reader lands.
// =============================================================================

export interface IndependenceReading {
  /** 0–1, or null when there is not enough data to answer honestly. */
  ratio: number | null;
  completedWithoutReminder: number;
  sampleSize: number;
}

export interface IndependenceReader {
  read(userId: string, from: Date, to: Date): Promise<IndependenceReading>;
}

/** DI token. E12-06 (#69) rebinds it; nothing else in this module changes. */
export const INDEPENDENCE_READER = Symbol('INDEPENDENCE_READER');

export class NullIndependenceReader implements IndependenceReader {
  async read(): Promise<IndependenceReading> {
    return { ratio: null, completedWithoutReminder: 0, sampleSize: 0 };
  }
}
