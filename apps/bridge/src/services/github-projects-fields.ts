/**
 * Name matching for GitHub Projects field parity leftovers (#277).
 */

export function isDueDateFieldName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (isStartDateFieldName(n)) return false;
  return ["target date", "due date", "due", "date", "end date"].includes(n);
}

export function isStartDateFieldName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "start date" || n === "start" || n === "start at";
}

export function isEstimateFieldName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return (
    n === "estimate" ||
    n === "story points" ||
    n === "points" ||
    n === "size" ||
    n === "effort"
  );
}

export function isTextNoteFieldName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return (
    n === "text" ||
    n === "note" ||
    n === "notes" ||
    n === "comment" ||
    n === "summary"
  );
}

export function isIterationFieldName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "iteration" || n === "sprint" || n === "cycle";
}

export type ExtraProjectFields = {
  startAt: string | null;
  estimate: number | null;
  textNote: string | null;
  iteration: string | null;
};

export function emptyExtraFields(): ExtraProjectFields {
  return {
    startAt: null,
    estimate: null,
    textNote: null,
    iteration: null,
  };
}
