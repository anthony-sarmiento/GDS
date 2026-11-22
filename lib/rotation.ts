import { Brk, Cell, CellPos, DayState, Limits, Position, POSITIONS, Settings, Shift } from "./types";

export const cellKey = (shiftId: string, cellStart: number) => `${shiftId}@${cellStart}`;

/** Leads are not on the board. Everyone else rotates. */
export const rotating = (shifts: Shift[]): Shift[] => shifts.filter((s) => !s.role);

/** Start times of every board column that touches the day's shifts. */
export function cellsFor(all: Shift[], settings: Settings): number[] {
  const shifts = rotating(all);
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

/**
 * Work out every column from what the lead has assigned. GDS never picks a position for anyone.
 * - Pinned cells (assigned or painted by the lead, plus cover blocks) are kept as they are.
 * - A column with nothing assigned inherits the position the person was last given, so someone stays
 *   where they were sent until the lead moves them. Cover blocks and custom spots ("Tournament") are
 *   temporary: afterwards the person goes back to where they were.
 * - Someone with "Stays at" set is on that position whenever nothing else is assigned.
 * - Before a person's first assignment the column stays empty ("needs a position").
 * - Cover blocks only live as long as the break they cover.
 * Everything that is not pinned is derived, so this can be run again after any change.
 */
export function autoFill(day: DayState, settings: Settings): Record<string, Cell> {
  const g = settings.gridMinutes;
  const crew = rotating(day.shifts);
  const out: Record<string, Cell> = {};
  const last = new Map<string, Position>();
  const liveBreaks = new Set(day.shifts.flatMap((s) => s.breaks.filter((b) => breakSpan(b)).map((b) => b.id)));

  for (const c of cellsFor(day.shifts, settings)) {
    for (const s of crew) {
      if (!isPresent(s, c, g)) continue;
      const key = cellKey(s.id, c);
      const e = day.cells[key];
      // once the lead gives someone their bumpout, that is their assignment until they leave
      if (s.bumpoutAt != null && c + g > s.bumpoutAt) {
        out[key] = { pos: "other", label: "Bumpout", pinned: false, bump: true };
        continue;
      }
      const tie = e?.cover ?? e?.after; // blocks tied to a break only live as long as the break
      if (e && e.pinned && !(tie && !liveBreaks.has(tie))) {
        out[key] = e;
        if (e.pos !== "other" && !e.cover) last.set(s.id, e.pos);
        if (e.ends) last.delete(s.id); // the assignment was given an end: nothing carries on after it
        continue;
      }
      const base = s.lock ?? last.get(s.id);
      if (base) out[key] = { pos: base, pinned: false };
    }
  }
  return out;
}

/** Does this person have a position (or custom spot) at time `t`? Nobody gets one until the lead assigns it. */
export function hasPositionAt(day: DayState, settings: Settings, shift: Shift, t: number): boolean {
  const c = cellAt(cellsFor(day.shifts, settings), settings.gridMinutes, t);
  return c != null && !!day.cells[cellKey(shift.id, c)];
}

/** Any stretch of this person's shift with nothing assigned yet. */
export function needsPosition(day: DayState, settings: Settings, shift: Shift): boolean {
  const g = settings.gridMinutes;
  return cellsFor(day.shifts, settings).some((c) => isPresent(shift, c, g) && !day.cells[cellKey(shift.id, c)]);
}

/** Minutes each person has spent (or is scheduled to spend) at each position, breaks excluded. */
export function positionMinutes(day: DayState, settings: Settings): Record<string, Minutes> {
  const g = settings.gridMinutes;
  const crew = rotating(day.shifts);
  const out: Record<string, Minutes> = Object.fromEntries(crew.map((s) => [s.id, zero()]));
  for (const c of cellsFor(day.shifts, settings)) {
    for (const s of crew) {
      const cell = day.cells[cellKey(s.id, c)];
      if (cell && cell.pos !== "other" && !breakAtCell(s, c, g)) out[s.id][cell.pos] += overlap(s, c, g);
    }
  }
  return out;
}

/** Who is on each position in this column (people on break are left out). */
export function staffAt(day: DayState, settings: Settings, c: number): Record<Position, Shift[]> {
  const g = settings.gridMinutes;
  const out: Record<Position, Shift[]> = { front: [], bar: [], dungeon: [] };
  for (const s of rotating(day.shifts)) {
    if (!isPresent(s, c, g) || breakAtCell(s, c, g)) continue;
    const cell = day.cells[cellKey(s.id, c)];
    if (cell && cell.pos !== "other") out[cell.pos].push(s);
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
  /** Working on a custom block (Tournament, Photo booth...) instead of a position. */
  elsewhere: { shift: Shift; label: string }[];
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
  const elsewhere: LiveFloor["elsewhere"] = [];
  if (c == null) return { cell: null, byPos, onBreak, elsewhere };
  for (const s of rotating(day.shifts)) {
    if (!(s.start <= t && t < s.end)) continue;
    const cell = day.cells[cellKey(s.id, c)];
    const pos = cell && cell.pos !== "other" ? cell.pos : null;
    const brk = activeBreak(s);
    if (brk) onBreak.push({ shift: s, pos, brk });
    else if (cell?.pos === "other") elsewhere.push({ shift: s, label: cell.label || "Other" });
    else if (pos) byPos[pos].push(s);
  }
  return { cell: c, byPos, onBreak, elsewhere };
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
  if (shift.role) return { position: null, remaining: 0, min: 0, status: "ok" };
  const g = settings.gridMinutes;
  // judged once the walk to cover the position is over
  const c = cellAt(cellsFor(day.shifts, settings), g, t);
  const cAfter = cellAt(cellsFor(day.shifts, settings), g, t + settings.transitMinutes) ?? c;
  const cell = c == null ? undefined : day.cells[cellKey(shift.id, c)];
  if (c == null || !cell) return { position: null, remaining: 0, min: 0, status: "unknown" };
  if (cell.pos === "other") return { position: null, remaining: 0, min: 0, status: "ok" };
  const position = cell.pos;
  const remaining = staffAt(day, settings, cAfter ?? c)[position].filter((s) => s.id !== shift.id).length;
  const { min } = settings.limits[position];
  return { position, remaining, min, status: remaining >= min ? "ok" : staffStatus(remaining, settings.limits[position]) };
}

export interface PosRun {
  pos: CellPos;
  label?: string;
  start: number;
  end: number;
}

/** One person's day as merged blocks: neighbouring columns on the same position become one block. `gaps` are stretches with nothing assigned. */
export function positionRuns(
  day: DayState,
  settings: Settings,
  shift: Shift,
): { runs: PosRun[]; pins: [number, number][]; gaps: [number, number][] } {
  const g = settings.gridMinutes;
  const runs: PosRun[] = [];
  const pins: [number, number][] = [];
  const gaps: [number, number][] = [];
  for (const c of cellsFor(day.shifts, settings)) {
    if (!isPresent(shift, c, g)) continue;
    const cell = day.cells[cellKey(shift.id, c)];
    const start = Math.max(c, shift.start);
    const end = Math.min(c + g, shift.end);
    if (!cell) {
      const lg = gaps[gaps.length - 1];
      if (lg && lg[1] === start) lg[1] = end;
      else gaps.push([start, end]);
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && last.pos === cell.pos && last.label === cell.label && last.end === start) last.end = end;
    else runs.push({ pos: cell.pos, label: cell.label, start, end });
    if (cell.pinned) {
      const lp = pins[pins.length - 1];
      if (lp && lp[1] === start) lp[1] = end;
      else pins.push([start, end]);
    }
  }
  return { runs, pins, gaps };
}

export interface CoverageRun {
  start: number;
  end: number;
  count: number;
  /** "transit" = short only because someone is walking over right now. */
  status: StaffStatus | "none" | "transit";
}

/** How many people are on a position over the day, merged into runs of the same count. */
export function coverageRuns(day: DayState, settings: Settings, pos: Position): CoverageRun[] {
  const g = settings.gridMinutes;
  const crew = rotating(day.shifts);
  const out: CoverageRun[] = [];
  for (const c of cellsFor(day.shifts, settings)) {
    const anyone = crew.some((s) => isPresent(s, c, g));
    const count = staffAt(day, settings, c)[pos].length;
    const walking = crew.some((s) => isPresent(s, c, g) && day.cells[cellKey(s.id, c)]?.transit);
    let status: CoverageRun["status"] = anyone ? staffStatus(count, settings.limits[pos]) : "none";
    if (walking && (status === "open" || status === "short")) status = "transit";
    const last = out[out.length - 1];
    if (last && last.count === count && last.status === status && last.end === c) last.end = c + g;
    else out.push({ start: c, end: c + g, count, status });
  }
  return out;
}
