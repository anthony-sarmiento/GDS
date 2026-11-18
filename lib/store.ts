import { AppState, Brk, CellPos, DayState, DEFAULT_LIMITS, DEFAULT_SETTINGS, LeadRole, Position, Settings, Shift } from "./types";
import { defaultBreaks, newBreak, syncShiftBreaks, uid } from "./breaks";
import { autoFill, breakAtCell, breakSpan, cellAt, cellKey, cellsFor, isPresent } from "./rotation";
import { clearAutoCells, clearCover } from "./cover";
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
    // the board always works at the finest step now
    gridMinutes: DEFAULT_SETTINGS.gridMinutes,
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
    const oldGrid = parsed.settings?.gridMinutes !== DEFAULT_SETTINGS.gridMinutes;
    const days = parsed.days ?? {};
    return {
      settings: mergeSettings(parsed.settings),
      names: parsed.names ?? [],
      // columns saved at an older step size do not line up, so deal those days again
      days: oldGrid
        ? Object.fromEntries(Object.entries(days).map(([d, v]) => [d, { ...v, cells: {} }]))
        : days,
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
 * Re-run the automatic parts after a change. GDS never recommends or places breaks: they appear on
 * the board only when the lead puts them there (Assign, the Break brush, or Start).
 * - "redeal" / "cells": re-deal unpinned columns (from `now` onward on a live day).
 * - "fill": leave everything as it is and only fill columns that have no position yet.
 */
export function refresh(
  day: DayState,
  state: AppState,
  now: number | null,
  mode: "redeal" | "cells" | "fill" = "redeal",
): DayState {
  if (mode === "fill") return { ...day, cells: autoFill(day, state.settings, Infinity) };
  return { ...day, cells: autoFill(day, state.settings, now ?? -Infinity) };
}

export function addShift(
  day: DayState,
  input: {
    name: string;
    start: number;
    end: number;
    lock: Position | null;
    floater: boolean;
    role?: LeadRole | null;
    roleLabel?: string;
  },
): DayState {
  const end = normalizeEnd(input.start, input.end);
  const shift: Shift = {
    id: uid("s"),
    name: input.name.trim(),
    start: input.start,
    end,
    lock: input.role ? null : input.lock,
    floater: input.role ? false : input.floater,
    role: input.role ?? null,
    ...(input.role === "custom" && input.roleLabel?.trim() ? { roleLabel: input.roleLabel.trim() } : {}),
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
    ...clearCover(day, breakId),
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

/** Paint a position (or a custom block with a typed label) onto columns of one person's row. Painted columns are pinned. */
export function paintCells(
  day: DayState,
  shiftId: string,
  cellStarts: number[],
  pos: CellPos,
  label?: string,
): DayState {
  const cells = { ...day.cells };
  const name = pos === "other" ? label?.trim() || undefined : undefined;
  for (const c of cellStarts) cells[cellKey(shiftId, c)] = { pos, pinned: true, ...(name ? { label: name } : {}) };
  return { ...day, cells };
}

/**
 * Push an assignment: send someone to a position (or a named custom spot) from one time until another.
 * The columns are pinned, so auto-deal leaves them alone; the rest of their day is untouched.
 */
export function assignRange(
  day: DayState,
  settings: Settings,
  shiftId: string,
  from: number,
  until: number,
  pos: CellPos,
  label?: string,
): DayState {
  const shift = day.shifts.find((s) => s.id === shiftId);
  if (!shift || until <= from) return day;
  const g = settings.gridMinutes;
  const cells = cellsFor(day.shifts, settings).filter((c) => c + g > from && c < until && isPresent(shift, c, g));
  return paintCells(day, shiftId, cells, pos, label);
}

/** Clear painted columns (they go back to automatic) and un-place any break shown there. */
export function eraseCells(day: DayState, settings: Settings, shiftId: string, cellStarts: number[]): DayState {
  const cells = { ...day.cells };
  for (const c of cellStarts) delete cells[cellKey(shiftId, c)];
  const g = settings.gridMinutes;
  const dropped: string[] = [];
  const shifts = day.shifts.map((s) =>
    s.id !== shiftId
      ? s
      : {
          ...s,
          breaks: s.breaks.map((b) => {
            if (b.start == null && cellStarts.some((c) => breakAtCell({ ...s, breaks: [b] }, c, g))) {
              dropped.push(b.id);
              return { ...b, planned: null, locked: false };
            }
            return b;
          }),
        },
  );
  let next: DayState = { ...day, cells, shifts };
  const spans = day.shifts
    .find((s) => s.id === shiftId)
    ?.breaks.filter((b) => dropped.includes(b.id))
    .map((b) => breakSpan(b)) ?? [];
  for (const id of dropped) next = clearCover(next, id);
  return clearAutoCells(next, g, spans);
}

/**
 * Put one of this person's breaks at an exact minute. Uses a break that has no time yet,
 * otherwise the nearest one that has not been taken, otherwise adds a new one.
 * `length` overrides the break's length (drag to set it). Returns the break that was used.
 */
export function placeBreak(
  day: DayState,
  shiftId: string,
  startMinute: number,
  length: number | null,
): { day: DayState; breakId: string | null } {
  const shift = day.shifts.find((s) => s.id === shiftId);
  if (!shift) return { day, breakId: null };
  const open = shift.breaks.filter((b) => b.start == null);
  const target =
    open.find((b) => b.planned == null) ??
    [...open].sort((a, b) => Math.abs((a.planned ?? 0) - startMinute) - Math.abs((b.planned ?? 0) - startMinute))[0];

  if (!target) {
    const brk = { ...newBreak(length ?? 20), planned: startMinute, locked: true };
    return {
      day: { ...day, shifts: day.shifts.map((s) => (s.id === shiftId ? { ...s, breaksCustom: true, breaks: [...s.breaks, brk] } : s)) },
      breakId: brk.id,
    };
  }
  return {
    day: updateBreak(clearCover(day, target.id), shiftId, target.id, {
      planned: startMinute,
      locked: true,
      ...(length ? { length } : {}),
    }),
    breakId: target.id,
  };
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
  const incoming = inId ? day.shifts.find((s) => s.id === inId && !s.role) : undefined;
  const g = settings.gridMinutes;
  const rot = settings.rotationMinutes;
  const time = Math.max(out.start + g, Math.min(out.end, t));

  // where was the person standing right before they left?
  const allCells = cellsFor(day.shifts, settings);
  const lastCell = cellAt(allCells, g, time - 1);
  const left = lastCell == null ? undefined : day.cells[cellKey(out.id, lastCell)];
  const pos = left?.pos;

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
      if (c + g > from && c < blockEnd) cells[cellKey(incoming.id, c)] = { pos, pinned: true, ...(left?.label ? { label: left.label } : {}) };
    }
    next = { ...next, cells };
  }
  return next;
}
