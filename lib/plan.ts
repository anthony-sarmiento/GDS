import { DayState, Position, Settings, Shift } from "./types";
import { analyzeCover, applyBreakChange, clearCover } from "./cover";
import { breakSpan, rotating } from "./rotation";
import { updateBreak } from "./store";

/** One person's break as the plan leaves it. */
export interface PlanItem {
  shiftId: string;
  breakId: string;
  name: string;
  length: number;
  preferred: number;
  /** Where the break ended up. */
  placed: number;
  /** Minutes away from what they asked for (negative = earlier). */
  moved: number;
  /** Who goes to their spot while they are away, if anyone had to. */
  coverName: string | null;
  /** The position they leave runs below its minimum even after the cover. */
  short: boolean;
  /** The position they leave for the break, if they were on one. */
  position: Position | null;
}

export interface Plan {
  day: DayState;
  items: PlanItem[];
  /** Breaks nobody asked a time for: left alone. */
  skipped: number;
}

const STEP = 5;
const REACH = 60; // never move a break more than an hour from what was asked

/**
 * Build a break plan around what people asked for. Everyone gets the time they want if the floor
 * can take it (one person away at a time unless the settings allow more, the position they leave
 * is still staffed or someone can step over). Otherwise the break moves to the nearest time that
 * works. Nothing is applied to the board by this function: the lead looks at the result and
 * decides. Breaks already taken are left alone.
 */
export function planFromPreferences(input: DayState, settings: Settings): Plan {
  const todo = input.shifts
    .flatMap((s) => s.breaks.filter((b) => b.start == null && b.preferred != null).map((b) => ({ s, b })))
    .sort((x, y) => x.b.preferred! - y.b.preferred! || x.s.start - y.s.start);
  const skipped = input.shifts.reduce((n, s) => n + s.breaks.filter((b) => b.start == null && b.preferred == null).length, 0);

  let day = input;
  const items: PlanItem[] = [];

  for (const { s, b } of todo) {
    const want = b.preferred!;
    // work on the current state of the shift, since earlier breaks may have changed it
    const shift = day.shifts.find((x) => x.id === s.id)!;
    const place = (d: DayState, t: number) => ({
      day: updateBreak(clearCover(d, b.id), s.id, b.id, { planned: t, locked: true }),
      breakId: b.id,
    });

    let best: { t: number; score: number; cover: string | null; short: boolean; position: Position | null } | null = null;
    for (let off = 0; off <= REACH; off += STEP) {
      for (const sign of off === 0 ? [1] : [1, -1]) {
        const t = want + sign * off;
        if (t < shift.start || t + b.length > shift.end) continue;
        if (clashes(day, settings, shift, b.id, t, b.length)) continue;

        const probe = place(day, t);
        const a = analyzeCover(probe.day, settings, s.id, b.id);
        let harm = 0;
        let cover: string | null = null;
        let short = false;
        if (a.position && a.needs) {
          const pick = a.options.find((o) => o.recommended);
          cover = pick?.shift.id ?? null;
          // 1 = a position drops below its minimum, 2 = it is left empty
          harm = pick ? (pick.harm === "none" ? 0 : 1) : a.remaining === 0 ? 3 : 2;
          short = !pick || pick.harm !== "none";
        }
        const score = harm * 1000 + off;
        if (!best || score < best.score) best = { t, score, cover, short, position: a.position };
      }
    }
    if (!best) continue;

    day = applyBreakChange(day, settings, (d) => place(d, best!.t), best.cover);
    const coverShift = best.cover ? day.shifts.find((x) => x.id === best!.cover) : undefined;
    items.push({
      shiftId: s.id,
      breakId: b.id,
      name: s.name,
      length: b.length,
      preferred: want,
      placed: best.t,
      moved: best.t - want,
      coverName: coverShift?.name ?? null,
      short: best.short,
      position: best.position,
    });
  }
  return { day, items, skipped };
}

/** Would this break overlap the same person's other break, or put too many people away at once? */
function clashes(day: DayState, settings: Settings, shift: Shift, breakId: string, t: number, len: number): boolean {
  const end = t + len;
  let others = 0;
  for (const s of day.shifts) {
    for (const o of s.breaks) {
      if (o.id === breakId) continue;
      const span = breakSpan(o);
      if (!span || !(t < span[1] && span[0] < end)) continue;
      if (s.id === shift.id) return true; // their own breaks never overlap
      if (!s.role) others += 1;
    }
  }
  return !shift.role && others >= settings.maxConcurrentBreaks;
}

/** People working the floor who have not said when they would like a break. */
export const withoutPreference = (day: DayState) =>
  rotating(day.shifts).filter((s) => s.breaks.some((b) => b.start == null && b.preferred == null));
