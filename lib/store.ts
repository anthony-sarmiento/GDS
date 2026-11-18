import { AppState, Brk, DayState, DEFAULT_SETTINGS, Position, Shift } from "./types";
import { defaultBreaks, newBreak, planBreaks, syncShiftBreaks, uid } from "./breaks";
import { autoFill } from "./rotation";
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

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
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
 * Re-run the automatic parts after a change: place any unplaced breaks and
 * re-deal unpinned rotation blocks (from `now` onward if the day is live).
 */
export function refresh(day: DayState, state: AppState, now: number | null): DayState {
  const notBefore = now ?? -Infinity;
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
