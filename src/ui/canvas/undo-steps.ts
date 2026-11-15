/**
 * Two executions as one undo step (Req 4.2: a line drawn with no type chosen, and the type then picked from
 * the menu the drawing opened). diagram-js's command stack groups its actions by an id — undo takes back every
 * action of the last id, redo redoes every action of the next — and gives each `execute` an id of its own.
 * diagram-js 14 has no public way to make a later execution part of an earlier one, so this sets the later
 * one's ids on the stack; where the stack is not as expected, it changes nothing.
 */

interface StackAction {
  id?: number;
}

interface StackInternals {
  _stack: StackAction[];
  _stackIdx: number;
}

function internals(commandStack: unknown): StackInternals | undefined {
  const stack = commandStack as Partial<StackInternals> | undefined;
  return stack && Array.isArray(stack._stack) && typeof stack._stackIdx === 'number' ? (stack as StackInternals) : undefined;
}

/** The id of the step an undo would take back, if any. */
export function lastStepId(commandStack: unknown): number | undefined {
  const stack = internals(commandStack);
  return stack ? stack._stack[stack._stackIdx]?.id : undefined;
}

/**
 * Make the last step part of step `id` when that is the step right before it, so that one undo takes both
 * back and one redo redoes both. False, changing nothing, when something else was done in between, when the
 * last step is `id` itself, or when the stack is not diagram-js's.
 */
export function joinLastStep(commandStack: unknown, id: number): boolean {
  const stack = internals(commandStack);
  if (!stack) return false;
  const last = stack._stack[stack._stackIdx];
  if (last?.id === undefined || last.id === id) return false;
  let first = stack._stackIdx;
  while (first > 0 && stack._stack[first - 1]?.id === last.id) first--;
  if (stack._stack[first - 1]?.id !== id) return false;
  for (let i = first; i <= stack._stackIdx; i++) stack._stack[i].id = id;
  return true;
}
