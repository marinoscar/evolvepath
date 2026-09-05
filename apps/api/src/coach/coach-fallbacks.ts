import type { AiErrorCode } from '../ai/gateway/ai-errors';

// =============================================================================
// What the coach says when there is no coach (issue #70, epic E06)
// =============================================================================
//
// PRD §120: the deterministic product keeps working when the provider does not.
// On this screen that means a message the user can read and act on, not a
// spinner and not a 500 — `POST /coach/messages` answers 201 for every one of
// these.
//
// Each line does the same two jobs: say what happened in the user's terms, and
// say what still works. "Your plan is unchanged" is there because the failure
// a user actually fears at this moment is that something happened to their
// plan while the screen was thinking.
// =============================================================================

export type CoachFallbackCode =
  | AiErrorCode
  | 'invalid_output'
  | 'hallucination_guard';

const FALLBACKS: Partial<Record<CoachFallbackCode, string>> = {
  invalid_output:
    "I couldn't produce a reliable answer just now. Your plan is unchanged. Try again, or pick one of the suggested prompts.",

  hallucination_guard:
    "I couldn't produce a reliable answer just now — what I came back with didn't match your actual plan, so I've left it out. Your plan is unchanged.",

  no_user_key:
    'Add your OpenAI key in Settings → AI to chat with the coach. Everything else in the app works without it.',

  ai_disabled:
    'The coach is turned off by your administrator. Your plan and today’s actions still work without it.',

  timeout:
    'The coach took too long to answer. Your plan is unchanged — try again in a moment.',

  rate_limit:
    'The coach is being rate-limited right now. Your plan is unchanged — try again shortly.',
};

const GENERIC =
  'The coach is unavailable right now. Your plan and today’s actions still work without it.';

export function fallbackReply(code: CoachFallbackCode): { content: string } {
  return { content: FALLBACKS[code] ?? GENERIC };
}
