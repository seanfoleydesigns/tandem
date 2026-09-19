// ALL Jev wording lives in this file. Nowhere else.
// Jev reads literally: when a decision is wrong, fix the wording here (or the state) before
// touching thresholds, and note the change in NOTES.md.
//
// Questions are plain objects in the documented request shape, so this file needs no SDK import.

export type ChoiceQuestion = {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string | null>;
};

// --- /api/health -----------------------------------------------------------------------------
// One small Choice in our own domain. It proves the key, the SDK and the response shape.

export const HEALTH_STATE = { utterance: 'scroll down a bit' };

export function healthQuestions(): { operation: ChoiceQuestion } {
  return {
    operation: {
      type: 'choice',
      instructions: 'Which browser operation does `utterance` ask for?',
      criteria: {
        SCROLL_DOWN: 'The user asks to move the page down.',
        SCROLL_UP: 'The user asks to move the page up.',
        GO_BACK: 'The user asks to return to the previous page.',
        NONE: 'None of the other options fits.',
      },
    },
  };
}
