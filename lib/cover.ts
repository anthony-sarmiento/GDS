import { DayState, Position, Settings, Shift } from "./types";
import { breakAtCell, breakSpan, cellKey, cellsFor, isPresent, rotating } from "./rotation";

/**
 * The columns that change when `who` takes a new spot from `from` on: the rest of the time they were due
 * to stay on `oldPos`, up to the next thing the lead set for them. `null` means the lead already set
 * something different for the very first moment, so nothing should change.
 */
export function afterRun(
  shifts: Shift[],
  settings: Settings,
  cells: DayState["cells"],
  who: Shift,
  from: number,
  oldPos: Position,
): string[] | null {
  const g = settings.gridMinutes;
  const all = cellsFor(shifts, settings);
  const start = all.findIndex((c) => c <= from && from < c + g);
  if (start < 0) return [];
  const keys: string[] = [];
  for (const c of all.slice(start)) {
    if (!isPresent(who, c, g)) continue;
    const k = cellKey(who.id, c);
    const e = cells[k];
    if (e && e.pinned && !e.cover && !e.after && e.pos !== oldPos) {
      if (keys.length === 0) return null;
      break;
    }
    if (!e || !e.pinned) keys.push(k); // empty, or carried on from earlier: it becomes part of the change
    else if (!e.cover && !e.after) keys.push(k);
  }
  return keys;
}

/** How many board columns the walk between two spots takes. */
export const transitColumns = (settings: Settings): number =>
  settings.transitMinutes > 0 ? Math.ceil(settings.transitMinutes / settings.gridMinutes) : 0;

/** Remove the blocks that were added to cover this break. */
export function clearCover(day: DayState, breakId: string): DayState {
  const tied = (c: { cover?: string; after?: string }) => c.cover === breakId || c.after === breakId;
  if (!Object.values(day.cells).some(tied)) return day;
  return {
    ...day,
    cells: Object.fromEntries(Object.entries(day.cells).filter(([, c]) => !tied(c))),
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

export interface CoverOption {
  shift: Shift;
  /** Where they are standing now. */
  from: Position;
  /** People left on their own position if they move. */
  fromAfter: number;
  fromMin: number;
  /** What moving them does to the position they leave. */
  harm: "none" | "short" | "empty";
  /** Stays at one position all day. */
  locked: boolean;
  /** What GDS would pick on its own. */
  recommended: boolean;
}

export interface CoverAnalysis {
  position: Position | null;
  span: [number, number] | null;
  spanCells: number[];
  /** People who stay on the position while the holder is away. */
  remaining: number;
  min: number;
  /** The position would be left below its minimum without a cover. */
  needs: boolean;
  /** Everyone who could rotate over, best first. */
  options: CoverOption[];
}

/**
 * Everyone who could rotate onto `position` for `spanCells` (the person at `excludeId` is leaving it),
 * and what it costs. Best first: GDS's own pick (floater, then anyone their position can spare),
 * then people whose position stays fully staffed, then ones it leaves short, then ones it would
 * leave empty. GDS never applies the pick by itself; it is only a suggestion.
 */
export function coverOptions(
  day: DayState,
  settings: Settings,
  position: Position,
  spanCells: number[],
  excludeId: string,
): Pick<CoverAnalysis, "remaining" | "min" | "needs" | "options"> {
  const g = settings.gridMinutes;
  const c0 = spanCells[0];
  const posOf = (s: Shift): Position | undefined => {
    const p = day.cells[cellKey(s.id, c0)]?.pos;
    return p === "other" ? undefined : p;
  };
  const working = rotating(day.shifts).filter(
    (s) => s.id !== excludeId && s.sentHomeAt == null && isPresent(s, c0, g) && !breakAtCell(s, c0, g),
  );
  const countAt = (p: Position) => working.filter((s) => posOf(s) === p).length;
  const remaining = countAt(position);
  const min = settings.limits[position].min;
  const needs = remaining < min;

  // free for the whole span and not already on this position
  const options: CoverOption[] = working
    .filter((s) => {
      const from = posOf(s);
      return from && from !== position && !spanCells.some((c) => breakAtCell(s, c, g));
    })
    .map((s) => {
      const from = posOf(s)!;
      const fromAfter = countAt(from) - 1;
      const fromMin = settings.limits[from].min;
      const harm: CoverOption["harm"] = fromAfter <= 0 ? "empty" : fromAfter < fromMin ? "short" : "none";
      return { shift: s, from, fromAfter, fromMin, harm, locked: !!s.lock, recommended: false };
    });

  const order = (a: CoverOption, b: CoverOption) =>
    Number(b.shift.floater) - Number(a.shift.floater) || countAt(b.from) - countAt(a.from);
  const spare = options.filter((o) => o.harm === "none" && !o.locked).sort(order);
  const lenient = remaining === 0 ? options.filter((o) => o.fromAfter >= 1 && !o.locked).sort(order) : [];
  const pick = needs ? (spare[0] ?? lenient[0]) : undefined;
  if (pick) pick.recommended = true;

  const harmRank = { none: 0, short: 1, empty: 2 };
  options.sort(
    (a, b) =>
      Number(b.recommended) - Number(a.recommended) ||
      Number(a.locked) - Number(b.locked) ||
      harmRank[a.harm] - harmRank[b.harm] ||
      Number(b.shift.floater) - Number(a.shift.floater),
  );
  return { remaining, min, needs, options };
}

/** Who could rotate over while the holder of this break is away, and what it costs. */
export function analyzeCover(input: DayState, settings: Settings, shiftId: string, breakId: string): CoverAnalysis {
  const day = clearCover(input, breakId);
  const empty: CoverAnalysis = { position: null, span: null, spanCells: [], remaining: 0, min: 0, needs: false, options: [] };

  const shift = day.shifts.find((s) => s.id === shiftId);
  const brk = shift?.breaks.find((b) => b.id === breakId);
  if (!shift || !brk || shift.role) return empty;
  const span = breakSpan(brk);
  if (!span) return empty;

  const g = settings.gridMinutes;
  const spanCells = cellsFor(day.shifts, settings).filter(
    (c) => c < span[1] && c + g > span[0] && isPresent(shift, c, g),
  );
  const c0 = spanCells[0];
  if (c0 == null) return empty;
  const position = day.cells[cellKey(shift.id, c0)]?.pos;
  // on a custom block (or nothing at all): no position to cover
  if (!position || position === "other") return empty;

  return { position, span, spanCells, ...coverOptions(day, settings, position, spanCells, shift.id) };
}

/**
 * A break needs somebody else on the position while the person is away.
 * `choice` says who: undefined lets GDS pick (floater first, then anyone their position can spare),
 * a shift id is the person you chose, and null means nobody covers.
 * The moved blocks are pinned and tagged with the break so they vanish if the break does.
 */
export function assignCover(
  input: DayState,
  settings: Settings,
  shiftId: string,
  breakId: string,
  choice?: string | null,
): CoverResult {
  const day = clearCover(input, breakId);
  const a = analyzeCover(day, settings, shiftId, breakId);
  const base: CoverResult = {
    day,
    status: "none-needed",
    position: a.position,
    cover: null,
    from: null,
    span: a.span,
    remaining: a.remaining,
  };
  if (!a.position || !a.span) return base;

  const picked =
    choice === undefined ? a.options.find((o) => o.recommended) : choice === null ? undefined : a.options.find((o) => o.shift.id === choice);
  if (!picked) return a.needs ? { ...base, status: a.remaining === 0 ? "uncovered" : "short" } : base;

  const g = settings.gridMinutes;
  const cells = { ...day.cells };
  const walk = transitColumns(settings);
  let i = 0;
  for (const c of a.spanCells) {
    if (!isPresent(picked.shift, c, g)) continue;
    // the first few minutes are spent walking over; they are on neither spot
    cells[cellKey(picked.shift.id, c)] =
      i < walk
        ? { pos: "other", label: "Moving", pinned: true, cover: breakId, transit: true }
        : { pos: a.position, pinned: true, cover: breakId };
    i += 1;
  }

  // A break is also a rotation: when it ends the holder takes the cover's old spot and the cover stays
  // where they are. If the lead already set something for that moment, no swap happens.
  const holder = day.shifts.find((s) => s.id === shiftId)!;
  const mine = afterRun(day.shifts, settings, cells, holder, a.span[1], a.position);
  const theirs = afterRun(day.shifts, settings, cells, picked.shift, a.span[1], picked.from);
  if (mine && theirs && mine.length && theirs.length) {
    for (const k of mine) cells[k] = { pos: picked.from, pinned: true, after: breakId };
    for (const k of theirs) cells[k] = { pos: a.position, pinned: true, after: breakId };
  }
  return { ...base, day: { ...day, cells }, status: "covered", cover: picked.shift, from: picked.from };
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
  choice?: string | null,
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
  const owner = newB?.shift ?? oldB?.shift;
  // Work out the cover first: it needs to see where everyone is standing right now.
  // Only then clear the automatic blocks where the break was and is, so the board fills them in
  // fresh. The cover blocks are pinned, so that cleanup leaves them alone.
  let day = owner ? assignCover(r.day, settings, owner.id, r.breakId, choice).day : r.day;
  day = clearAutoCells(day, settings.gridMinutes, [
    oldB ? breakSpan(oldB.brk) : null,
    newB ? breakSpan(newB.brk) : null,
  ]);
  return day;
}

/**
 * Who could step onto a position that has been left short at column `c`.
 * First choice is someone their own position can spare (floater first). If the position would be
 * left empty, someone whose position stays attended will do. `busyCells` are columns the mover must
 * be free for.
 */
export function suggestMover(
  day: DayState,
  settings: Settings,
  position: Position,
  c: number,
  excludeId: string,
  busyCells: number[] = [c],
): { shift: Shift; from: Position } | null {
  const g = settings.gridMinutes;
  const posOf = (s: Shift): Position | undefined => {
    const p = day.cells[cellKey(s.id, c)]?.pos;
    return p === "other" ? undefined : p;
  };
  const working = rotating(day.shifts).filter(
    (s) => s.id !== excludeId && isPresent(s, c, g) && !breakAtCell(s, c, g) && s.sentHomeAt == null,
  );
  const countAt = (p: Position) => working.filter((s) => posOf(s) === p).length;
  const remaining = countAt(position);
  if (remaining >= settings.limits[position].min) return null;

  const movable = working.filter((s) => {
    const from = posOf(s);
    return from && from !== position && !s.lock && !busyCells.some((b) => breakAtCell(s, b, g));
  });
  const order = (a: Shift, b: Shift) =>
    Number(b.floater) - Number(a.floater) || countAt(posOf(b)!) - countAt(posOf(a)!);
  const spare = movable.filter((s) => countAt(posOf(s)!) - 1 >= settings.limits[posOf(s)!].min).sort(order);
  const lenient = remaining === 0 ? movable.filter((s) => countAt(posOf(s)!) - 1 >= 1).sort(order) : [];
  const pick = spare[0] ?? lenient[0];
  return pick ? { shift: pick, from: posOf(pick)! } : null;
}
