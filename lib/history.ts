/** Undo / redo for one day. Snapshots are whole-day copies, so every kind of change is undoable. */
export interface History<T> {
  undo: T[];
  redo: T[];
  /** When the last snapshot was taken (ms), so a burst of edits (typing) counts as one step. */
  lastPush: number;
}

export const emptyHistory = <T>(): History<T> => ({ undo: [], redo: [], lastPush: 0 });

const CAP = 60;
export const COALESCE_MS = 700;

/** Remember `before` as the state to return to. Changes made in quick succession share one step. */
export function recordChange<T>(h: History<T>, before: T, now: number, coalesceMs = COALESCE_MS): History<T> {
  const burst = h.undo.length > 0 && now - h.lastPush < coalesceMs;
  if (burst) return { ...h, lastPush: now, redo: [] };
  return { undo: [...h.undo, before].slice(-CAP), redo: [], lastPush: now };
}

/** Step back. Snapshots identical to the current state are skipped. */
export function stepBack<T>(
  h: History<T>,
  current: T,
  same: (a: T, b: T) => boolean,
): { history: History<T>; state: T | null } {
  const undo = [...h.undo];
  while (undo.length) {
    const snap = undo.pop() as T;
    if (!same(snap, current)) {
      return { history: { undo, redo: [...h.redo, current], lastPush: 0 }, state: snap };
    }
  }
  return { history: { ...h, undo }, state: null };
}

/** Step forward again after an undo. */
export function stepForward<T>(
  h: History<T>,
  current: T,
  same: (a: T, b: T) => boolean,
): { history: History<T>; state: T | null } {
  const redo = [...h.redo];
  while (redo.length) {
    const snap = redo.pop() as T;
    if (!same(snap, current)) {
      return { history: { undo: [...h.undo, current], redo, lastPush: 0 }, state: snap };
    }
  }
  return { history: { ...h, redo }, state: null };
}
