import { DayState, Brk, Settings, Shift, POSITIONS } from "./types";
import { hoursOf } from "./time";

/** Break rules straight off the GEEK'D daily break log. */
export const SHIFT_RULES: { label: string; breaks: string }[] = [
  { label: "Less than 7 hrs", breaks: "1 × 20 min" },
  { label: "7 hrs up to less than 9 hrs", breaks: "1 × 30–60 min" },
  { label: "9 hrs up to less than 12 hrs", breaks: "1 × 20 min & 1 × 30–60 min" },
  { label: "12+ hrs", breaks: "2 × 20 min & 1 × 30–60 min" },
];

/** Required break lengths (minutes) in the order they're normally taken. */
export function requiredBreaks(hours: number): number[] {
  // Compare in whole minutes so 6:59 counts as "less than 7 hrs".
  const mins = Math.round(hours * 60);
  if (mins < 7 * 60) return [20];
  if (mins < 9 * 60) return [30];
  if (mins < 12 * 60) return [20, 30];
  return [20, 20, 30];
}

let counter = 0;
export function uid(prefix = "id"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newBreak(length: number): Brk {
  return {
    id: uid("b"),
    length,
    planned: null,
    locked: false,
    start: null,
    end: null,
    empInitials: "",
    leadInitials: "",
    notes: "",
  };
}

export function defaultBreaks(shift: Pick<Shift, "start" | "end">): Brk[] {
  return requiredBreaks(hoursOf(shift.start, shift.end)).map(newBreak);
}

/** When the break time is known, this is it: actual start if taken, else the plan. */
export function effectiveStart(b: Brk): number | null {
  return b.start ?? b.planned;
}

export type BreakStatus = "scheduled" | "active" | "done" | "unplanned";
export function breakStatus(b: Brk): BreakStatus {
  if (b.end != null) return "done";
  if (b.start != null) return "active";
  return b.planned == null ? "unplanned" : "scheduled";
}

const GRID = 15;
const MIN_GAP_SAME_PERSON = 90;

interface Interval {
  shiftId: string;
  start: number;
  end: number;
}

const ceilTo = (v: number, step: number) => Math.ceil(v / step) * step;
const floorTo = (v: number, step: number) => Math.floor(v / step) * step;

/** Earliest/latest a break of `len` minutes may start in this shift. */
export function breakWindow(shift: Shift, len: number): { lo: number; hi: number } {
  const L = shift.end - shift.start;
  const minBefore = Math.min(90, L * 0.25);
  const minAfter = Math.min(60, L * 0.15);
  return {
    lo: ceilTo(shift.start + minBefore, GRID),
    hi: floorTo(shift.end - minAfter - len, GRID),
  };
}

/**
 * Place every unplaced break onto a 15-minute grid so breaks are staggered
 * (no more than `maxConcurrentBreaks` at once), fall near the middle of each
 * shift, and prefer times when the floor is fully staffed.
 *
 * Breaks already taken or set by hand stay put and count as occupied time.
 * `replanAll` re-places everything else too; otherwise only breaks with no time yet are placed.
 * `notBefore` stops the planner from scheduling into the past.
 */
export function planBreaks(
  day: DayState,
  settings: Settings,
  opts: { replanAll?: boolean; notBefore?: number } = {},
): DayState {
  const { replanAll = false, notBefore = -Infinity } = opts;

  const fixed: Interval[] = [];
  const todo: { shift: Shift; brk: Brk; index: number; count: number }[] = [];

  for (const shift of day.shifts) {
    shift.breaks.forEach((brk, index) => {
      const isFixed = brk.start != null || brk.locked || (!replanAll && brk.planned != null);
      if (isFixed) {
        const s = effectiveStart(brk);
        if (s != null) fixed.push({ shiftId: shift.id, start: s, end: s + (brk.end != null && brk.start != null ? brk.end - brk.start : brk.length) });
      } else {
        todo.push({ shift, brk, index, count: shift.breaks.length });
      }
    });
  }

  const targetOf = (t: (typeof todo)[number]) => {
    const L = t.shift.end - t.shift.start;
    return t.shift.start + (L * (t.index + 1)) / (t.count + 1) - t.brk.length / 2;
  };
  todo.sort((a, b) => targetOf(a) - targetOf(b) || a.shift.start - b.shift.start);

  const placed = new Map<string, number>();
  const occupied = [...fixed];

  const presentAt = (t: number) => day.shifts.filter((s) => s.start <= t && t < s.end).length;
  const breakingAt = (t: number, extra: Interval) =>
    [...occupied, extra].filter((i) => i.start <= t && t < i.end).length;

  for (const item of todo) {
    const { shift, brk } = item;
    const { lo, hi } = breakWindow(shift, brk.length);
    const target = targetOf(item);
    const mine = occupied.filter((i) => i.shiftId === shift.id);

    let best: { t: number; score: number } | null = null;
    for (let extra = 0; extra <= 3 && !best; extra += 1) {
      const cap = settings.maxConcurrentBreaks + extra;
      for (let t = Math.max(lo, ceilTo(notBefore, GRID)); t <= hi; t += GRID) {
        const cand: Interval = { shiftId: shift.id, start: t, end: t + brk.length };
        // keep a person's own breaks well apart
        if (mine.some((m) => t < m.end + MIN_GAP_SAME_PERSON && m.start < cand.end + MIN_GAP_SAME_PERSON)) continue;
        let ok = true;
        let thin = 0;
        for (let x = t; x < cand.end; x += GRID) {
          const breaking = breakingAt(x, cand);
          if (breaking > cap) {
            ok = false;
            break;
          }
          if (presentAt(x) - breaking < POSITIONS.length) thin += 1;
        }
        if (!ok) continue;
        const score = Math.abs(t - target) + thin * 60;
        if (!best || score < best.score) best = { t, score };
      }
    }

    if (best) {
      placed.set(brk.id, best.t);
      occupied.push({ shiftId: shift.id, start: best.t, end: best.t + brk.length });
    }
  }

  return {
    ...day,
    shifts: day.shifts.map((s) => ({
      ...s,
      breaks: s.breaks.map((b) => {
        if (b.start != null || b.locked) return b;
        if (placed.has(b.id)) return { ...b, planned: placed.get(b.id)! };
        // replanAll that found no slot leaves the old plan; otherwise stays unplanned
        return b;
      }),
    })),
  };
}

/**
 * Keep a shift's break list in step with its hours. Called when clock in/out changes.
 * Hand-edited lists and breaks already started are left alone.
 */
export function syncShiftBreaks(shift: Shift): Shift {
  if (shift.breaksCustom || shift.breaks.some((b) => b.start != null)) return shift;
  const want = defaultBreaks(shift);
  const same =
    want.length === shift.breaks.length && want.every((w, i) => w.length === shift.breaks[i].length);
  return same ? shift : { ...shift, breaks: want };
}

export function isOnBreakAt(shift: Shift, t: number): boolean {
  return shift.breaks.some((b) => {
    const s = effectiveStart(b);
    if (s == null) return false;
    return s <= t && t < (b.end ?? s + b.length);
  });
}
