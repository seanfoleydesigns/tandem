// The store's questions must stay word for word the same when a task has no search query and no unmet
// attributes. The fixture was written from the wording as it stood at M5 step 2 (commit 2280cc4; it was 22ac82b before the history rewrite of 2026-09-20), before
// typing on the task leash and the DONE gate were added. A deliberate rewording updates the fixture, with a
// note in NOTES.md and a probe run; an accidental one fails here.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kindQuestion, needsQuestions, operationQuestionSingle, operationQuestionTask, slateQuestions, TASK_TARGET_INSTRUCTIONS } from '../shared/questions';

const pinned = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/questions-pinned.json'), 'utf8'));

describe('question wording, pinned', () => {
  it('task-leash operation, with no query to type and nothing unmet', () => expect(operationQuestionTask()).toEqual(pinned.operationTask));
  it('task-leash target instructions', () => expect(TASK_TARGET_INSTRUCTIONS).toMatchObject(pinned.taskTargets));
  it('single-leash operation and kind', () => {
    expect(operationQuestionSingle()).toEqual(pinned.operationSingle);
    expect(kindQuestion({ hasPending: false, textboxFocused: false })).toEqual(pinned.kind);
  });
  it('needs and slate', () => {
    expect(needsQuestions({ label: 'Size', options: ['10', '10.5'] })).toEqual(pinned.needs);
    expect(slateQuestions(['Colour: White'])).toEqual(pinned.slate);
  });
});
