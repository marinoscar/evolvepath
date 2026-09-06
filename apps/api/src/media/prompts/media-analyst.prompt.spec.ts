import {
  MEDIA_ANALYST_PROMPT_VERSION,
  buildMediaAnalystInput,
  buildMediaAnalystInstructions,
} from './media-analyst.prompt';

describe('media analyst prompt', () => {
  it('is versioned, because that is what makes a regression answerable', () => {
    expect(MEDIA_ANALYST_PROMPT_VERSION).toBe('media_analyst.v1');
  });

  describe('per-purpose rules', () => {
    it('forbids calories and macros for a meal, in so many words', () => {
      // PRD §46 and VISION §16: this feature begins with behaviour, and the
      // one thing a photo of food invites is a calorie count. The prohibition
      // is asserted here because a prompt is not compiled, so nothing else
      // would notice it being softened.
      const meal = buildMediaAnalystInstructions('MEAL');

      expect(meal).toContain('NEVER');
      expect(meal.toLowerCase()).toContain('calorie');
      expect(meal.toLowerCase()).toContain('macronutrient');
      expect(meal.toLowerCase()).toContain('gram');
      // And never a judgment about the person.
      expect(meal.toLowerCase()).toContain('never judge');
    });

    it('names the professional-care flag for a form check', () => {
      const form = buildMediaAnalystInstructions('WORKOUT_FORM');

      expect(form).toContain('seek_professional');
      expect(form.toLowerCase()).toContain('sharp pain');
      // Cues alongside "get this looked at" read as permission to keep going.
      expect(form).toContain('no coaching cues on that path');
    });

    it('keeps equipment claims to what is visible', () => {
      const equipment = buildMediaAnalystInstructions('EQUIPMENT');

      expect(equipment.toLowerCase()).toContain('recognise');
      expect(equipment.toLowerCase()).toContain('cannot read');
    });

    it('applies the common rules to every purpose', () => {
      for (const purpose of [
        'WORKOUT_FORM',
        'EQUIPMENT',
        'MEAL',
        'GENERAL',
      ] as const) {
        const instructions = buildMediaAnalystInstructions(purpose);
        expect(instructions).toContain('ONLY what is visible');
        // The instruction that keeps the whole feature honest: a model asked
        // to coach from a blurry video will coach from a blurry video.
        expect(instructions.toLowerCase()).toContain('unclear');
        expect(instructions.toLowerCase()).toContain('no medical diagnosis');
      }
    });
  });

  describe('input text', () => {
    it('lists the frame timestamps and says they are one clip', () => {
      // Without this, a model handed six images of a squat has no way to know
      // whether it is seeing one rep from six angles or six reps — and it will
      // confidently pick one.
      const input = buildMediaAnalystInput({
        purpose: 'WORKOUT_FORM',
        kind: 'VIDEO',
        durationMs: 3000,
        frameTimestampsMs: [250, 750, 1250],
      });

      expect(input).toContain('Video, 3 s, 3 frames');
      expect(input).toContain('0.3 s, 0.8 s, 1.3 s');
      expect(input).toContain('one continuous clip, in order');
    });

    it('says "Photo." for a still', () => {
      expect(
        buildMediaAnalystInput({ purpose: 'MEAL', kind: 'PHOTO' }),
      ).toContain('Photo.');
    });

    it('carries the question when there is one', () => {
      const input = buildMediaAnalystInput({
        purpose: 'WORKOUT_FORM',
        kind: 'PHOTO',
        question: '  Is my back rounding?  ',
      });

      expect(input).toContain('The user asks: Is my back rounding?');
    });

    it('says so when there is no question, rather than leaving a blank', () => {
      const input = buildMediaAnalystInput({
        purpose: 'GENERAL',
        kind: 'PHOTO',
        question: '   ',
      });

      expect(input).toContain('did not ask anything specific');
    });
  });
});
