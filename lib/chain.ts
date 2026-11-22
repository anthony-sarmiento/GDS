import { CellPos, DayState, Position, Settings, Shift } from "./types";
import { afterRun, applyBreakChange } from "./cover";
import { breakAtCell, breakSpan, cellAt, cellKey, cellsFor, isPresent, rotating } from "./rotation";
import { assignRange, bumpOut, placeBreak } from "./store";

/** Where one person goes in a rotation chain. */
export type ChainDest = CellPos | "break" | "bumpout";

export interface ChainMove {
  shiftId: string;
  dest: ChainDest;
  /** Name for a custom spot. */
  label?: string;
  /** When this move starts. Defaults to the time of the whole chain. */
  from?: number;
  /** When the move ends (the end of a break; ignored for a bumpout). */
  until: number;
}

/** The position this person holds at time `t`, if they are on one (not on break, not walking, not sent home). */
export function positionAt(day: DayState, settings: Settings, shift: Shift, t: number): Position | null {
  const g = settings.gridMinutes;
  const c = cellAt(cellsFor(day.shifts, settings), g, t);
  if (c == null || shift.sentHomeAt != null || !isPresent(shift, c, g) || breakAtCell(shift, c, g)) return null;
  const cell = day.cells[cellKey(shift.id, c)];
  return cell && cell.pos !== "other" && !cell.transit ? cell.pos : null;
}

/** Everyone on a position at `t`, except the people already moving in this chain. */
export function peopleAt(day: DayState, settings: Settings, pos: Position, t: number, skip: string[] = []): Shift[] {
  return rotating(day.shifts).filter((s) => !skip.includes(s.id) && positionAt(day, settings, s, t) === pos);
}

/**
 * Carry out a chain of moves that all happen at time `from`: each person goes to their place, usually
 * sending the person who was standing there somewhere else. Someone sent on break comes back to the spot
 * the previous mover left. Someone bumped out is done for the day.
 */
export function applyChain(input: DayState, settings: Settings, from: number, moves: ChainMove[]): DayState {
  // where everyone was standing before anything moved
  const was = new Map<string, Position | null>();
  for (const m of moves) {
    const s = input.shifts.find((x) => x.id === m.shiftId);
    if (s) was.set(m.shiftId, positionAt(input, settings, s, from));
  }

  let day = input;
  moves.forEach((m, i) => {
    const shift = day.shifts.find((s) => s.id === m.shiftId);
    if (!shift) return;
    const prev = i > 0 ? moves[i - 1] : null;
    const t = m.from ?? from;

    if (m.dest === "bumpout") {
      day = bumpOut(day, settings, shift.id, null, t);
      const taker = prev ? day.shifts.find((s) => s.id === prev.shiftId) : undefined;
      if (taker) day = { ...day, shifts: day.shifts.map((s) => (s.id === shift.id ? { ...s, bumpedBy: taker.name } : s)) };
      return;
    }

    if (m.dest === "break") {
      let placedId: string | null = null;
      day = applyBreakChange(
        day,
        settings,
        (d) => {
          const r = placeBreak(d, shift.id, t, Math.max(5, m.until - t));
          placedId = r.breakId;
          return r;
        },
        null,
      );
      // afterwards they go where the person who took their spot came from
      const old = was.get(shift.id);
      const next = prev ? was.get(prev.shiftId) : null;
      const brk = day.shifts.find((s) => s.id === shift.id)?.breaks.find((b) => b.id === placedId);
      const span = brk ? breakSpan(brk) : null;
      if (old && next && next !== old && placedId && span) {
        const keys = afterRun(day.shifts, settings, day.cells, day.shifts.find((s) => s.id === shift.id)!, span[1], old);
        if (keys && keys.length) {
          const cells = { ...day.cells };
          for (const k of keys) cells[k] = { pos: next, pinned: true, after: placedId };
          day = { ...day, cells };
        }
      }
      return;
    }

    day = assignRange(day, settings, shift.id, t, m.until, m.dest, m.label);
  });
  return day;
}
