import { DayState, Position, Settings, Shift } from "./types";
import { breakAtCell, breakSpan, cellKey, cellsFor, isPresent, rotating } from "./rotation";

/** Remove the blocks that were added to cover this break. */
export function clearCover(day: DayState, breakId: string): DayState {
  if (!Object.values(day.cells).some((c) => c.cover === breakId)) return day;
  return {
    ...day,
    cells: Object.fromEntries(Object.entries(day.cells).filter(([, c]) => c.cover !== breakId)),
  };
}

export interface CoverResult {
  day: DayState;
  /**
   * none-needed: the position stays at its minimum without help (or the person is a lead)
   * covered: someone was moved onto the position for the length of the break
   * short: the position stays attended but runs below its minimum (nobody could be spared)
   * uncovered: the position would be left empty and nobody can move over
   */
  status: "none-needed" | "covered" | "short" | "uncovered";
  /** People left on the position during the break (before any cover moves). */
  remaining: number;
  position: Position | null;
  cover: Shift | null;
  /** Where the cover person was standing before they moved. */
  from: Position | null;
  span: [number, number] | null;
}

/**
 * A break needs somebody else on the position while the person is away.
 * If the position would drop below its minimum, move the best available person onto it for the
 * length of the break: the floater first, then anyone whose own position can spare them.
 * The moved blocks are pinned and tagged with the break so they vanish if the break does.
 */
export function assignCover(input: DayState, settings: Settings, shiftId: string, breakId: string): CoverResult {
  const day = clearCover(input, breakId);
  const none = (status: CoverResult["status"] = "none-needed"): CoverResult => ({
    day,
    status,
    position: null,
    cover: null,
    from: null,
    span: null,
    remaining: 0,
  });

  const shift = day.shifts.find((s) => s.id === shiftId);
  const brk = shift?.breaks.find((b) => b.id === breakId);
  if (!shift || !brk || shift.role) return none();
  const span = breakSpan(brk);
  if (!span) return none();

  const g = settings.gridMinutes;
  const spanCells = cellsFor(day.shifts, settings).filter(
    (c) => c < span[1] && c + g > span[0] && isPresent(shift, c, g),
  );
  const c0 = spanCells[0];
  if (c0 == null) return none();
  const position = day.cells[cellKey(shift.id, c0)]?.pos;
  // on a custom block (or nothing at all): no position to cover
  if (!position || position === "other") return none();

  const crew = rotating(day.shifts);
  const posOf = (s: Shift): Position | undefined => {
    const p = day.cells[cellKey(s.id, c0)]?.pos;
    return p === "other" ? undefined : p;
  };
  const working = crew.filter((s) => s.id !== shift.id && isPresent(s, c0, g) && !breakAtCell(s, c0, g));
  const countAt = (p: Position) => working.filter((s) => posOf(s) === p).length;

  const remaining = countAt(position);
  if (remaining >= settings.limits[position].min) return { ...none(), position, span, remaining };

  // Anyone free for the whole break who is not locked to their spot.
  const movable = working.filter((s) => {
    const from = posOf(s);
    return from && from !== position && !s.lock && !spanCells.some((c) => breakAtCell(s, c, g));
  });
  const order = (a: Shift, b: Shift) =>
    Number(b.floater) - Number(a.floater) || countAt(posOf(b)!) - countAt(posOf(a)!);
  // First choice: someone their own position can spare. If the position would otherwise be left
  // empty, take someone whose position stays attended (it runs short, but nobody is left alone).
  const spare = movable.filter((s) => countAt(posOf(s)!) - 1 >= settings.limits[posOf(s)!].min).sort(order);
  const lenient = remaining === 0 ? movable.filter((s) => countAt(posOf(s)!) - 1 >= 1).sort(order) : [];
  const pick = spare[0] ?? lenient[0];
  if (!pick) return { ...none(remaining === 0 ? "uncovered" : "short"), position, span, remaining };

  const cells = { ...day.cells };
  for (const c of spanCells) {
    if (isPresent(pick, c, g)) cells[cellKey(pick.id, c)] = { pos: position, pinned: true, cover: breakId };
  }
  return { day: { ...day, cells }, status: "covered", position, cover: pick, from: posOf(pick) ?? null, span, remaining };
}

/** Drop the automatic (unpinned) blocks inside these time spans so the board fills them in fresh. */
export function clearAutoCells(day: DayState, g: number, spans: ([number, number] | null)[]): DayState {
  const real = spans.filter((s): s is [number, number] => s != null);
  if (!real.length) return day;
  const cells = Object.fromEntries(
    Object.entries(day.cells).filter(([k, c]) => {
      if (c.pinned) return true;
      const t = Number(k.split("@")[1]);
      return !real.some(([a, z]) => t + g > a && t < z);
    }),
  );
  return { ...day, cells };
}

/**
 * Run a change to one break and tidy up around it: automatic blocks where the break used to be
 * and where it is now are dealt again, and the cover rule is applied to the new position.
 */
export function applyBreakChange(
  before: DayState,
  settings: Settings,
  build: (d: DayState) => { day: DayState; breakId: string | null },
): DayState {
  const r = build(before);
  if (!r.breakId) return r.day;
  const find = (d: DayState) => {
    for (const s of d.shifts) {
      const b = s.breaks.find((x) => x.id === r.breakId);
      if (b) return { shift: s, brk: b };
    }
    return null;
  };
  const oldB = find(before);
  const newB = find(r.day);
  let day = clearAutoCells(r.day, settings.gridMinutes, [
    oldB ? breakSpan(oldB.brk) : null,
    newB ? breakSpan(newB.brk) : null,
  ]);
  const owner = newB?.shift ?? oldB?.shift;
  if (owner) day = assignCover(day, settings, owner.id, r.breakId).day;
  return day;
}
