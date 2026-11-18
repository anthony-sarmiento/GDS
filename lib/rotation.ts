import { Cell, DayState, Position, POSITIONS, Settings, Shift } from "./types";
import { isOnBreakAt } from "./breaks";

export const cellKey = (shiftId: string, slotStart: number) => `${shiftId}@${slotStart}`;

/** Start times of every rotation block that touches the day's shifts. */
export function slotsFor(shifts: Shift[], settings: Settings): number[] {
  if (!shifts.length) return [];
  const { rotationMinutes: step, anchor } = settings;
  const min = Math.min(...shifts.map((s) => s.start));
  const max = Math.max(...shifts.map((s) => s.end));
  const first = anchor + Math.floor((min - anchor) / step) * step;
  const out: number[] = [];
  for (let t = first; t < max; t += step) out.push(t);
  return out;
}

export function overlap(shift: Shift, slotStart: number, step: number): number {
  return Math.max(0, Math.min(shift.end, slotStart + step) - Math.max(shift.start, slotStart));
}

/** On the floor for this block (a few minutes at the edge does not count). */
export function isPresent(shift: Shift, slotStart: number, step: number): boolean {
  return overlap(shift, slotStart, step) >= Math.min(15, step / 2);
}

export type Minutes = Record<Position, number>;
const zero = (): Minutes => ({ front: 0, bar: 0, dungeon: 0 });

// Tuning knobs for the assignment cost function.
const PER_HOUR_AT_POSITION = 12; // each hour already spent at a position makes it less attractive
const SAME_AS_LAST = 20; // staying put when you could rotate
const BALANCE = 30; // squared headcount, so extra people spread across positions
const EMPTY: Record<Position, number> = { front: 1000, bar: 900, dungeon: 800 };

/**
 * Pick positions for everyone free to move in one block.
 * Brute-forces the (small) search space for the cheapest mix of:
 *   - every position staffed (Front first, then Bar, then Dungeon),
 *   - extra people spread out rather than piled on one position,
 *   - each person drawn toward the positions they have spent the least time at,
 *   - nobody sitting in the same spot two blocks in a row.
 */
function assign(
  free: { prev: Position | null; minutes: Minutes }[],
  fixedCounts: Minutes,
  tieShift: number,
): Position[] {
  const n = free.length;
  if (n === 0) return [];

  const personCost = free.map((p, i) =>
    POSITIONS.map(
      (q, qi) =>
        (p.minutes[q] / 60) * PER_HOUR_AT_POSITION +
        (p.prev === q ? SAME_AS_LAST : 0) +
        ((qi + i + tieShift) % POSITIONS.length) * 0.01,
    ),
  );

  let best = Infinity;
  let bestPick: number[] = [];
  const pick = new Array<number>(n).fill(0);
  const counts = POSITIONS.map((q) => fixedCounts[q]);

  const walk = (i: number, running: number) => {
    if (running >= best) return;
    if (i === n) {
      let total = running;
      POSITIONS.forEach((q, qi) => {
        total += counts[qi] * counts[qi] * BALANCE;
        if (counts[qi] === 0) total += EMPTY[q];
      });
      if (total < best) {
        best = total;
        bestPick = pick.slice();
      }
      return;
    }
    for (let qi = 0; qi < POSITIONS.length; qi += 1) {
      pick[i] = qi;
      counts[qi] += 1;
      walk(i + 1, running + personCost[i][qi]);
      counts[qi] -= 1;
    }
  };
  walk(0, 0);

  return bestPick.map((qi) => POSITIONS[qi]);
}

/**
 * (Re)build the rotation grid.
 * - Pinned cells (set by hand) never move.
 * - Blocks that start before `recomputeFrom` keep what they have (only gaps are filled),
 *   so changing things mid-shift does not rewrite the past.
 * - Everything else is re-dealt, with locked-position staff held in place.
 */
export function autoFill(
  day: DayState,
  settings: Settings,
  recomputeFrom = -Infinity,
): Record<string, Cell> {
  const step = settings.rotationMinutes;
  const slots = slotsFor(day.shifts, settings);
  const out: Record<string, Cell> = {};
  const minutes = new Map<string, Minutes>(day.shifts.map((s) => [s.id, zero()]));
  const prev = new Map<string, Position | null>(day.shifts.map((s) => [s.id, null]));

  slots.forEach((slot, slotIdx) => {
    const recompute = slot >= recomputeFrom;
    const present = day.shifts.filter((s) => isPresent(s, slot, step));

    const fixedCounts = zero();
    const free: Shift[] = [];
    const decided = new Map<string, Cell>();

    for (const s of present) {
      const existing = day.cells[cellKey(s.id, slot)];
      if (existing && (existing.pinned || !recompute)) {
        decided.set(s.id, existing);
        fixedCounts[existing.pos] += 1;
      } else if (s.lock) {
        decided.set(s.id, { pos: s.lock, pinned: false });
        fixedCounts[s.lock] += 1;
      } else {
        free.push(s);
      }
    }

    const picks = assign(
      free.map((s) => ({ prev: prev.get(s.id) ?? null, minutes: minutes.get(s.id)! })),
      fixedCounts,
      slotIdx,
    );
    free.forEach((s, i) => decided.set(s.id, { pos: picks[i], pinned: false }));

    for (const s of present) {
      const cell = decided.get(s.id)!;
      out[cellKey(s.id, slot)] = cell;
      minutes.get(s.id)![cell.pos] += overlap(s, slot, step);
      prev.set(s.id, cell.pos);
    }
  });

  return out;
}

/** Minutes each person has spent (or is scheduled to spend) at each position. */
export function positionMinutes(day: DayState, settings: Settings): Record<string, Minutes> {
  const step = settings.rotationMinutes;
  const out: Record<string, Minutes> = Object.fromEntries(day.shifts.map((s) => [s.id, zero()]));
  for (const slot of slotsFor(day.shifts, settings)) {
    for (const s of day.shifts) {
      const cell = day.cells[cellKey(s.id, slot)];
      if (cell) out[s.id][cell.pos] += overlap(s, slot, step);
    }
  }
  return out;
}

export function slotAt(slots: number[], step: number, t: number): number | null {
  return slots.find((s) => s <= t && t < s + step) ?? null;
}

export interface CoverPlan {
  position: Position | null;
  /** Who moves to cover (null if nobody needs to or nobody can). */
  cover: Shift | null;
  /** Where the cover person normally stands, so they know what they are leaving. */
  coverFrom: Position | null;
  status: "none-needed" | "cover" | "uncovered" | "unknown";
}

/**
 * Who covers a position while someone is on break?
 * Nobody if another person is already there; otherwise the floater,
 * otherwise someone from a position that has more than one person.
 */
export function coverFor(day: DayState, settings: Settings, shift: Shift, t: number): CoverPlan {
  const step = settings.rotationMinutes;
  const slot = slotAt(slotsFor(day.shifts, settings), step, t);
  const cell = slot == null ? undefined : day.cells[cellKey(shift.id, slot)];
  if (slot == null || !cell) return { position: null, cover: null, coverFrom: null, status: "unknown" };

  const position = cell.pos;
  const posOf = (s: Shift) => day.cells[cellKey(s.id, slot)]?.pos;
  const working = day.shifts.filter(
    (s) => s.id !== shift.id && s.start <= t && t < s.end && posOf(s) && !isOnBreakAt(s, t),
  );

  if (working.some((s) => posOf(s) === position)) {
    return { position, cover: null, coverFrom: null, status: "none-needed" };
  }

  const countAt = (p: Position) => working.filter((s) => posOf(s) === p).length;
  const movable = working.filter((s) => !s.lock);
  const pick =
    movable.find((s) => s.floater) ?? movable.find((s) => countAt(posOf(s)!) > 1) ?? null;

  if (pick) return { position, cover: pick, coverFrom: posOf(pick) ?? null, status: "cover" };
  return { position, cover: null, coverFrom: null, status: "uncovered" };
}
