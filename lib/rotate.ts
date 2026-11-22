import { DayState, Position, POSITIONS, Settings, Shift } from "./types";
import { applyBreakChange, afterRun } from "./cover";
import { breakAtCell, breakSpan, cellAt, cellKey, cellsFor, isPresent, rotating } from "./rotation";
import { assignRange, placeBreak } from "./store";

/** Where one person goes in a rotation. "stay" means no change. */
export type Dest = Position | "break" | "stay";
export interface Move {
  shiftId: string;
  dest: Dest;
}

/** Who is on a position (or has no position) at time `t`, ignoring people on break and anyone walking. */
export function floorAt(day: DayState, settings: Settings, t: number): { shift: Shift; pos: Position }[] {
  const g = settings.gridMinutes;
  const c = cellAt(cellsFor(day.shifts, settings), g, t);
  if (c == null) return [];
  const out: { shift: Shift; pos: Position }[] = [];
  for (const s of rotating(day.shifts)) {
    if (s.sentHomeAt != null || !isPresent(s, c, g) || breakAtCell(s, c, g)) continue;
    const cell = day.cells[cellKey(s.id, c)];
    if (cell && cell.pos !== "other") out.push({ shift: s, pos: cell.pos });
  }
  return out;
}

/**
 * A starting point for a rotation: everyone moves to a different position while the number of people
 * on each stays the same. The lead can change any of it. With everyone on one position nobody can move.
 */
export function suggestRotation(day: DayState, settings: Settings, t: number): Move[] {
  const people = floorAt(day, settings, t).sort(
    (a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || a.shift.start - b.shift.start,
  );
  const n = people.length;
  if (n < 2) return people.map((p) => ({ shiftId: p.shift.id, dest: "stay" as Dest }));
  let bestShift = 1;
  let fewest = Infinity;
  for (let k = 1; k < n; k += 1) {
    const stays = people.filter((p, i) => people[(i + k) % n].pos === p.pos).length;
    if (stays < fewest) {
      fewest = stays;
      bestShift = k;
    }
  }
  return people.map((p, i) => {
    const dest = people[(i + bestShift) % n].pos;
    return { shiftId: p.shift.id, dest: dest === p.pos ? ("stay" as Dest) : dest };
  });
}

/** Headcount on each position once the moves are done. */
export function afterRotation(day: DayState, settings: Settings, t: number, moves: Move[]): Record<Position, number> {
  const counts: Record<Position, number> = { front: 0, bar: 0, dungeon: 0 };
  for (const { shift, pos } of floorAt(day, settings, t)) {
    const m = moves.find((x) => x.shiftId === shift.id);
    const dest = !m || m.dest === "stay" ? pos : m.dest;
    if (dest !== "break") counts[dest] += 1;
  }
  return counts;
}

/**
 * Carry out a rotation at time `t`. Everyone who moves goes to the new position for the rest of their
 * shift, with the short walk in between. Someone sent on break starts it now, and when it ends takes
 * the spot of whoever moved onto theirs.
 */
export function applyRotation(input: DayState, settings: Settings, t: number, moves: Move[]): DayState {
  const here = floorAt(input, settings, t);
  const posOf = (id: string) => here.find((p) => p.shift.id === id)?.pos;
  let day = input;

  // positions first, then breaks, so a break sees where everyone is going
  for (const m of moves) {
    if (m.dest === "stay" || m.dest === "break") continue;
    const shift = day.shifts.find((s) => s.id === m.shiftId);
    if (!shift || posOf(m.shiftId) === m.dest) continue;
    day = assignRange(day, settings, shift.id, t, shift.end, m.dest);
  }

  for (const m of moves) {
    if (m.dest !== "break") continue;
    const shift = day.shifts.find((s) => s.id === m.shiftId);
    const old = posOf(m.shiftId);
    if (!shift) continue;
    let placedId: string | null = null;
    day = applyBreakChange(
      day,
      settings,
      (d) => {
        const r = placeBreak(d, shift.id, t, null);
        placedId = r.breakId;
        return r;
      },
      null,
    );
    // when the break is over they go where the person who took over their spot came from
    const taker = moves.find((x) => x.dest === old && x.shiftId !== m.shiftId && posOf(x.shiftId) && posOf(x.shiftId) !== old);
    const next = taker ? posOf(taker.shiftId) : undefined;
    const brk = day.shifts.find((s) => s.id === shift.id)?.breaks.find((b) => b.id === placedId);
    const span = brk ? breakSpan(brk) : null;
    if (old && next && placedId && span) {
      const keys = afterRun(day.shifts, settings, day.cells, shift, span[1], old);
      if (keys && keys.length) {
        const cells = { ...day.cells };
        for (const k of keys) cells[k] = { pos: next, pinned: true, after: placedId };
        day = { ...day, cells };
      }
    }
  }
  return day;
}
