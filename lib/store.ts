import { AppState, Brk, DayState, DEFAULT_LIMITS, DEFAULT_SETTINGS, Position, Settings, Shift } from "./types";
import { defaultBreaks, newBreak, planBreaks, syncShiftBreaks, uid } from "./breaks";
import { autoFill, breakAtCell, cellAt, cellKey, cellsFor } from "./rotation";
import { normalizeEnd } from "./time";

export const STORAGE_KEY = "gds:v1";

export const emptyDay = (date: string): DayState => ({
  date,
  opener: "",
  closer: "",
  shifts: [],
  cells: {},
});

export const initialState = (): AppState => ({
  settings: { ...DEFAULT_SETTINGS },
  names: [],
  days: {},
});

export function mergeSettings(saved?: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...(saved ?? {}),
    limits: {
      front: { ...DEFAULT_LIMITS.front, ...(saved?.limits?.front ?? {}) },
      bar: { ...DEFAULT_LIMITS.bar, ...(saved?.limits?.bar ?? {}) },
      dungeon: { ...DEFAULT_LIMITS.dungeon, ...(saved?.limits?.dungeon ?? {}) },
    },
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      settings: mergeSettings(parsed.settings),
      names: parsed.names ?? [],
      days: parsed.days ?? {},
    };
  } catch {
    return initialState();
  }
}

export function saveState(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked - the app still works for this session */
  }
}

/**
 * Re-run the automatic parts after a change.
 * - "redeal": place any unplaced breaks and re-deal unpinned columns (from `now` onward on a live day).
 * - "cells": re-deal unpinned columns only (a break moved or was stamped, but do not re-plan breaks).
 * - "fill": leave everything as it is and only fill columns that have no position yet.
 */
export function refresh(
  day: DayState,
  state: AppState,
  now: number | null,
  mode: "redeal" | "cells" | "fill" = "redeal",
): DayState {
  if (mode === "fill") return { ...day, cells: autoFill(day, state.settings, Infinity) };
  const notBefore = now ?? -Infinity;
  if (mode === "cells") return { ...day, cells: autoFill(day, state.settings, notBefore) };
  const planned = planBreaks(day, state.settings, { notBefore });
  return { ...planned, cells: autoFill(planned, state.settings, notBefore) };
}

export function addShift(
  day: DayState,
  input: { name: string; start: number; end: number; lock: Position | null; floater: boolean },
): DayState {
  const end = normalizeEnd(input.start, input.end);
  const shift: Shift = {
    id: uid("s"),
    name: input.name.trim(),
    start: input.start,
    end,
    lock: input.lock,
    floater: input.floater,
    breaks: defaultBreaks({ start: input.start, end }),
    breaksCustom: false,
  };
  return { ...day, shifts: [...day.shifts, shift] };
}

export function updateShift(
  day: DayState,
  id: string,
  patch: Partial<Omit<Shift, "id" | "breaks">>,
): DayState {
  return {
    ...day,
    shifts: day.shifts.map((s) => {
      if (s.id !== id) return s;
      const merged = { ...s, ...patch };
      if (patch.start !== undefined || patch.end !== undefined) {
        merged.end = normalizeEnd(merged.start, merged.end);
        const synced = syncShiftBreaks(merged);
        // a planned break that no longer fits inside the shift goes back to "unplaced"
        return {
          ...synced,
          breaks: synced.breaks.map((b) =>
            b.start == null && !b.locked && b.planned != null &&
            (b.planned < synced.start || b.planned + b.length > synced.end)
              ? { ...b, planned: null }
              : b,
          ),
        };
      }
      return merged;
    }),
  };
}

export function removeShift(day: DayState, id: string): DayState {
  const cells = Object.fromEntries(Object.entries(day.cells).filter(([k]) => !k.startsWith(`${id}@`)));
  return { ...day, shifts: day.shifts.filter((s) => s.id !== id), cells };
}

export function updateBreak(day: DayState, shiftId: string, breakId: string, patch: Partial<Brk>): DayState {
  return {
    ...day,
    shifts: day.shifts.map((s) =>
      s.id !== shiftId
        ? s
        : {
            ...s,
            breaksCustom: patch.length !== undefined ? true : s.breaksCustom,
            breaks: s.breaks.map((b) => (b.id === breakId ? { ...b, ...patch } : b)),
          },
    ),
  };
}

export function addBreak(day: DayState, shiftId: string, length = 20): DayState {
  return {
    ...day,
    shifts: day.shifts.map((s) =>
      s.id === shiftId ? { ...s, breaksCustom: true, breaks: [...s.breaks, newBreak(length)] } : s,
    ),
  };
}

export function removeBreak(day: DayState, shiftId: string, breakId: string): DayState {
  return {
    ...day,
    shifts: day.shifts.map((s) =>
      s.id === shiftId ? { ...s, breaksCustom: true, breaks: s.breaks.filter((b) => b.id !== breakId) } : s,
    ),
  };
}

/** Most recent earlier day that had a team, for the "copy last team" shortcut. */
export function lastTeamBefore(state: AppState, date: string): DayState | null {
  const dates = Object.keys(state.days)
    .filter((d) => d < date && state.days[d].shifts.length)
    .sort();
  return dates.length ? state.days[dates[dates.length - 1]] : null;
}

export function copyTeam(from: DayState, to: DayState): DayState {
  const shifts: Shift[] = from.shifts.map((s) => ({
    ...s,
    id: uid("s"),
    breaks: defaultBreaks(s),
    breaksCustom: false,
  }));
  return { ...to, opener: from.opener, closer: from.closer, shifts, cells: {} };
}

export function rememberName(names: string[], name: string): string[] {
  const n = name.trim();
  if (!n || names.some((x) => x.toLowerCase() === n.toLowerCase())) return names;
  return [...names, n].sort((a, b) => a.localeCompare(b));
}

/** Stamp the break as started at `t` (a break can only be started once). */
export function startBreak(day: DayState, shiftId: string, breakId: string, t: number): DayState {
  return updateBreak(day, shiftId, breakId, { start: Math.round(t), end: null });
}

export function endBreak(day: DayState, shiftId: string, breakId: string, t: number): DayState {
  return updateBreak(day, shiftId, breakId, { end: Math.round(t) });
}

/** Clear the actual times (mis-tap) and fall back to the plan. */
export function resetBreak(day: DayState, shiftId: string, breakId: string): DayState {
  return updateBreak(day, shiftId, breakId, { start: null, end: null });
}

/** Paint a position onto columns of one person's row. Painted columns are pinned. */
export function paintCells(day: DayState, shiftId: string, cellStarts: number[], pos: Position): DayState {
  const cells = { ...day.cells };
  for (const c of cellStarts) cells[cellKey(shiftId, c)] = { pos, pinned: true };
  return { ...day, cells };
}

/** Clear painted columns (they go back to automatic) and un-place any break shown there. */
export function eraseCells(day: DayState, settings: Settings, shiftId: string, cellStarts: number[]): DayState {
  const cells = { ...day.cells };
  for (const c of cellStarts) delete cells[cellKey(shiftId, c)];
  const g = settings.gridMinutes;
  return {
    ...day,
    cells,
    shifts: day.shifts.map((s) =>
      s.id !== shiftId
        ? s
        : {
            ...s,
            breaks: s.breaks.map((b) =>
              b.start == null && cellStarts.some((c) => breakAtCell({ ...s, breaks: [b] }, c, g))
                ? { ...b, planned: null, locked: false }
                : b,
            ),
          },
    ),
  };
}

/**
 * Put one of this person's breaks at a column. Uses a break that has no time yet,
 * otherwise the nearest one that has not been taken, otherwise adds a new one.
 * Dragging over several columns sets the break's length to the dragged span.
 */
export function placeBreak(
  day: DayState,
  settings: Settings,
  shiftId: string,
  startCell: number,
  spanMinutes: number | null,
): DayState {
  const shift = day.shifts.find((s) => s.id === shiftId);
  if (!shift) return day;
  const open = shift.breaks.filter((b) => b.start == null);
  const target =
    open.find((b) => b.planned == null) ??
    [...open].sort((a, b) => Math.abs((a.planned ?? 0) - startCell) - Math.abs((b.planned ?? 0) - startCell))[0];

  const dragged = spanMinutes != null && spanMinutes > settings.gridMinutes ? spanMinutes : null;

  if (!target) {
    const brk = { ...newBreak(dragged ?? 20), planned: startCell, locked: true };
    return { ...day, shifts: day.shifts.map((s) => (s.id === shiftId ? { ...s, breaksCustom: true, breaks: [...s.breaks, brk] } : s)) };
  }
  return updateBreak(day, shiftId, target.id, {
    planned: startCell,
    locked: true,
    ...(dragged ? { length: dragged } : {}),
  });
}

/**
 * Bump out: `outId` is sent home at `t` and `inId` (usually someone from the later shift) takes
 * over their position from that moment, for the rest of the current rotation block.
 */
export function bumpOut(
  day: DayState,
  settings: Settings,
  outId: string,
  inId: string | null,
  t: number,
): DayState {
  const out = day.shifts.find((s) => s.id === outId);
  if (!out) return day;
  const incoming = inId ? day.shifts.find((s) => s.id === inId) : undefined;
  const g = settings.gridMinutes;
  const rot = settings.rotationMinutes;
  const time = Math.max(out.start + g, Math.min(out.end, t));

  // where was the person standing right before they left?
  const allCells = cellsFor(day.shifts, settings);
  const lastCell = cellAt(allCells, g, time - 1);
  const pos = lastCell == null ? undefined : day.cells[cellKey(out.id, lastCell)]?.pos;

  let next = updateShift(day, out.id, { end: time });
  next = {
    ...next,
    shifts: next.shifts.map((s) =>
      s.id === out.id ? { ...s, sentHomeAt: time, bumpedBy: incoming?.name } : s,
    ),
  };

  if (incoming && pos) {
    const from = Math.max(time, incoming.start);
    const blockEnd = settings.anchor + (Math.floor((from - settings.anchor) / rot) + 1) * rot;
    const cells = { ...next.cells };
    for (const c of allCells) {
      if (c + g > from && c < blockEnd) cells[cellKey(incoming.id, c)] = { pos, pinned: true };
    }
    next = { ...next, cells };
  }
  return next;
}
