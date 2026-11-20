import { Check, DayState, Settings } from "./types";
import { uid } from "./breaks";

/** Bathroom checks done today, oldest first. Days saved before checks existed have none. */
export const checksOf = (day: DayState): Check[] =>
  [...(day.checks ?? [])].sort((a, b) => a.time - b.time);

export function addCheck(day: DayState, time: number, by = ""): DayState {
  const check: Check = { id: uid("c"), time: Math.round(time), by: by.trim() };
  return { ...day, checks: [...(day.checks ?? []), check] };
}

export function removeCheck(day: DayState, id: string): DayState {
  return { ...day, checks: (day.checks ?? []).filter((c) => c.id !== id) };
}

/** When the store is open on this day: first clock-in to last clock-out, or null with no team. */
export function openWindow(day: DayState): { start: number; end: number } | null {
  if (!day.shifts.length) return null;
  return {
    start: Math.min(...day.shifts.map((s) => s.start)),
    end: Math.max(...day.shifts.map((s) => s.end)),
  };
}

export interface CheckStatus {
  /** The most recent check at or before `now`, if any. */
  last: Check | null;
  /** Minutes since the last check, or since opening when there has not been one. null when closed. */
  since: number | null;
  /** True when a check has never been logged today (so `since` counts from opening). */
  never: boolean;
  /** Past the recommended interval. A nudge only: checks are never required. */
  due: boolean;
  /** Time the next check is recommended, or null when closed. */
  nextAt: number | null;
}

export function checkStatus(day: DayState, settings: Settings, now: number | null): CheckStatus {
  const win = openWindow(day);
  const closed: CheckStatus = { last: null, since: null, never: false, due: false, nextAt: null };
  if (now == null || !win || now < win.start || now >= win.end) return closed;
  const last = [...checksOf(day)].reverse().find((c) => c.time <= now) ?? null;
  const base = last ? last.time : win.start;
  const since = Math.max(0, now - base);
  return {
    last,
    since,
    never: !last,
    due: since >= settings.checkMinutes,
    nextAt: base + settings.checkMinutes,
  };
}

export interface CheckRow {
  check: Check;
  /** Minutes since the check before it (or since opening for the first one). */
  gap: number;
  /** The gap ran longer than the recommended interval. */
  long: boolean;
}

export function checkRows(day: DayState, settings: Settings): CheckRow[] {
  const win = openWindow(day);
  let prev = win ? win.start : null;
  return checksOf(day).map((check) => {
    const gap = prev == null ? 0 : Math.max(0, check.time - prev);
    prev = check.time;
    return { check, gap, long: gap > settings.checkMinutes };
  });
}

/** Average and longest gap between today's checks (needs two or more). */
export function checkStats(day: DayState): { count: number; average: number | null; longest: number | null } {
  const list = checksOf(day);
  const gaps = list.slice(1).map((c, i) => c.time - list[i].time);
  return {
    count: list.length,
    average: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
    longest: gaps.length ? Math.max(...gaps) : null,
  };
}
