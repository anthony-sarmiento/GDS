import { Brk, Cell, DayState, Limits, Position, POSITIONS, Settings, Shift } from "./types";

export const cellKey = (shiftId: string, cellStart: number) => `${shiftId}@${cellStart}`;

/** Start times of every board column that touches the day's shifts. */
export function cellsFor(shifts: Shift[], settings: Settings): number[] {
  if (!shifts.length) return [];
  const { gridMinutes: g, anchor } = settings;
  const min = Math.min(...shifts.map((s) => s.start));
  const max = Math.max(...shifts.map((s) => s.end));
  const first = anchor + Math.floor((min - anchor) / g) * g;
  const out: number[] = [];
  for (let t = first; t < max; t += g) out.push(t);
  return out;
}

export function cellAt(cells: number[], g: number, t: number): number | null {
  return cells.find((c) => c <= t && t < c + g) ?? null;
}

export function overlap(shift: Shift, cellStart: number, g: number): number {
  return Math.max(0, Math.min(shift.end, cellStart + g) - Math.max(shift.start, cellStart));
}

/** Working this column (a few minutes at the edge does not count). */
export function isPresent(shift: Shift, cellStart: number, g: number): boolean {
  return overlap(shift, cellStart, g) >= Math.min(15, g / 2);
}

/** The time a break occupies: what really happened if stamped, otherwise the plan. */
export function breakSpan(b: Brk): [number, number] | null {
  if (b.start != null) return [b.start, b.end ?? b.start + b.length];
  if (b.planned != null) return [b.planned, b.planned + b.length];
  return null;
}

/** The break (if any) that covers this column for this person. */
export function breakAtCell(shift: Shift, cellStart: number, g: number): Brk | undefined {
  return shift.breaks.find((b) => {
    const span = breakSpan(b);
    if (!span) return false;
    const [s, e] = span;
    const ov = Math.min(e, cellStart + g) - Math.max(s, cellStart);
    // always mark the column the break starts in, so short breaks never vanish
    return ov >= Math.min(10, g / 2) || (s >= cellStart && s < cellStart + g);
  });
}

/** Where the person is "really" on break right now (timer running). */
export function activeBreak(s: Shift): Brk | undefined {
  return s.breaks.find((b) => b.start != null && b.end == null);
}

export type Minutes = Record<Position, number>;
const zero = (): Minutes => ({ front: 0, bar: 0, dungeon: 0 });

// Tuning knobs for the assignment cost function.
const PER_HOUR_AT_POSITION = 12; // each hour already spent at a position makes it less attractive
const SAME_AS_LAST = 20; // staying put when a new rotation block starts
const CHANGE_MID_BLOCK = 40; // moving in the middle of a block (unless covering)
const FLOATER_MOVE = 5; // floaters move freely
const KEEP = 30; // leaving someone where the board already had them, so small edits do not reshuffle everything
const UNDER: Record<Position, number> = { front: 1000, bar: 900, dungeon: 800 }; // per missing person
const OVER = 600; // per person above the maximum
const EXTRA: Record<Position, number> = { bar: 1, front: 4, dungeon: 50 }; // where the people above the minimum go first

/**
 * Pick positions for everyone free to move in one column.
 * Brute-forces the (small) search space for the cheapest mix of:
 *   - every position at or above its SOP minimum (Front/Bar before Dungeon),
 *   - nobody above a position's maximum,
 *   - spare people go to the Bar first, then Front,
 *   - each person drawn toward the positions they have spent the least time at,
 *   - rotate at block boundaries, stay put in between.
 */
function assign(
  free: { prev: Position | null; minutes: Minutes; floater: boolean; keep: Position | null }[],
  fixedCounts: Minutes,
  limits: Record<Position, Limits>,
  boundary: boolean,
  tieShift: number,
): Position[] {
  const n = free.length;
  if (n === 0) return [];

  const personCost = free.map((p, i) =>
    POSITIONS.map((q, qi) => {
      let c = (p.minutes[q] / 60) * PER_HOUR_AT_POSITION + ((qi + i + tieShift) % POSITIONS.length) * 0.01;
      if (p.keep && p.keep !== q) c += KEEP;
      if (p.prev) {
        if (boundary) c += p.prev === q ? SAME_AS_LAST : 0;
        else c += p.prev === q ? 0 : p.floater ? FLOATER_MOVE : CHANGE_MID_BLOCK;
      }
      return c;
    }),
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
        const c = counts[qi];
        const { min, max } = limits[q];
        if (c < min) total += UNDER[q] * (min - c);
        if (c > max) total += OVER * (c - max);
        total += EXTRA[q] * Math.max(0, Math.min(c, max) - min);
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
 * (Re)deal the board.
 * - Pinned cells (painted by hand) never move.
 * - Columns that start before `recomputeFrom` keep what they have (only gaps are filled),
 *   so changing things mid-shift does not rewrite the past. Pass Infinity to only fill gaps.
 * - People on break are off the floor for those columns; others are moved to cover when a
 *   position would drop below its minimum.
 */
export function autoFill(
  day: DayState,
  settings: Settings,
  recomputeFrom = -Infinity,
): Record<string, Cell> {
  const { gridMinutes: g, rotationMinutes: rot, anchor, limits } = settings;
  const cells = cellsFor(day.shifts, settings);
  const out: Record<string, Cell> = {};
  const minutes = new Map<string, Minutes>(day.shifts.map((s) => [s.id, zero()]));
  const prev = new Map<string, Position | null>(day.shifts.map((s) => [s.id, null]));

  cells.forEach((c, idx) => {
    const recompute = c >= recomputeFrom;
    const boundary = (((c - anchor) % rot) + rot) % rot === 0;
    const present = day.shifts.filter((s) => isPresent(s, c, g));

    const fixedCounts = zero();
    const free: Shift[] = [];
    const decided = new Map<string, Cell>();

    for (const s of present) {
      const existing = day.cells[cellKey(s.id, c)];
      const onBreak = !!breakAtCell(s, c, g);
      if (existing && (existing.pinned || !recompute)) {
        decided.set(s.id, existing);
        if (!onBreak) fixedCounts[existing.pos] += 1;
      } else if (onBreak) {
        decided.set(s.id, { pos: prev.get(s.id) ?? s.lock ?? "front", pinned: false });
      } else if (s.lock) {
        decided.set(s.id, { pos: s.lock, pinned: false });
        fixedCounts[s.lock] += 1;
      } else {
        free.push(s);
      }
    }

    const picks = assign(
      free.map((s) => ({
        prev: prev.get(s.id) ?? null,
        minutes: minutes.get(s.id)!,
        floater: s.floater,
        keep: day.cells[cellKey(s.id, c)]?.pos ?? null,
      })),
      fixedCounts,
      limits,
      boundary,
      idx,
    );
    free.forEach((s, i) => decided.set(s.id, { pos: picks[i], pinned: false }));

    for (const s of present) {
      const cell = decided.get(s.id)!;
      out[cellKey(s.id, c)] = cell;
      if (!breakAtCell(s, c, g)) {
        minutes.get(s.id)![cell.pos] += overlap(s, c, g);
        prev.set(s.id, cell.pos);
      }
    }
  });

  return out;
}

/** Minutes each person has spent (or is scheduled to spend) at each position, breaks excluded. */
export function positionMinutes(day: DayState, settings: Settings): Record<string, Minutes> {
  const g = settings.gridMinutes;
  const out: Record<string, Minutes> = Object.fromEntries(day.shifts.map((s) => [s.id, zero()]));
  for (const c of cellsFor(day.shifts, settings)) {
    for (const s of day.shifts) {
      const cell = day.cells[cellKey(s.id, c)];
      if (cell && !breakAtCell(s, c, g)) out[s.id][cell.pos] += overlap(s, c, g);
    }
  }
  return out;
}

/** Who is on each position in this column (people on break are left out). */
export function staffAt(day: DayState, settings: Settings, c: number): Record<Position, Shift[]> {
  const g = settings.gridMinutes;
  const out: Record<Position, Shift[]> = { front: [], bar: [], dungeon: [] };
  for (const s of day.shifts) {
    if (!isPresent(s, c, g) || breakAtCell(s, c, g)) continue;
    const cell = day.cells[cellKey(s.id, c)];
    if (cell) out[cell.pos].push(s);
  }
  return out;
}

export type StaffStatus = "ok" | "short" | "open" | "over";
export function staffStatus(count: number, limit: Limits): StaffStatus {
  if (count === 0) return "open";
  if (count < limit.min) return "short";
  if (count > limit.max) return "over";
  return "ok";
}

export interface LiveFloor {
  cell: number | null;
  byPos: Record<Position, Shift[]>;
  onBreak: { shift: Shift; pos: Position | null; brk: Brk }[];
}

/**
 * What the floor looks like at time `t` in real life: positions come from the board,
 * and "on break" means the break timer has actually been started.
 */
export function liveFloor(day: DayState, settings: Settings, t: number): LiveFloor {
  const g = settings.gridMinutes;
  const c = cellAt(cellsFor(day.shifts, settings), g, t);
  const byPos: Record<Position, Shift[]> = { front: [], bar: [], dungeon: [] };
  const onBreak: LiveFloor["onBreak"] = [];
  if (c == null) return { cell: null, byPos, onBreak };
  for (const s of day.shifts) {
    if (!(s.start <= t && t < s.end)) continue;
    const pos = day.cells[cellKey(s.id, c)]?.pos ?? null;
    const brk = activeBreak(s);
    if (brk) onBreak.push({ shift: s, pos, brk });
    else if (pos) byPos[pos].push(s);
  }
  return { cell: c, byPos, onBreak };
}

/** Someone who can move to a short position: the floater first, then anyone from a position above its minimum. */
export function suggestCover(
  floor: LiveFloor,
  settings: Settings,
  pos: Position,
): { shift: Shift; from: Position } | null {
  const candidates: { shift: Shift; from: Position; score: number }[] = [];
  for (const from of POSITIONS) {
    if (from === pos) continue;
    const spare = floor.byPos[from].length - settings.limits[from].min;
    for (const shift of floor.byPos[from]) {
      if (shift.lock) continue;
      if (shift.floater) candidates.push({ shift, from, score: 100 });
      else if (spare > 0) candidates.push({ shift, from, score: spare });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ? { shift: candidates[0].shift, from: candidates[0].from } : null;
}

export interface BreakImpact {
  position: Position | null;
  remaining: number;
  min: number;
  status: StaffStatus | "unknown";
}

/** What happens to the position a person holds while they are on this break. */
export function breakImpact(day: DayState, settings: Settings, shift: Shift, t: number): BreakImpact {
  const g = settings.gridMinutes;
  const c = cellAt(cellsFor(day.shifts, settings), g, t);
  const cell = c == null ? undefined : day.cells[cellKey(shift.id, c)];
  if (c == null || !cell) return { position: null, remaining: 0, min: 0, status: "unknown" };
  const position = cell.pos;
  const remaining = staffAt(day, settings, c)[position].filter((s) => s.id !== shift.id).length;
  const { min } = settings.limits[position];
  return { position, remaining, min, status: remaining >= min ? "ok" : staffStatus(remaining, settings.limits[position]) };
}
